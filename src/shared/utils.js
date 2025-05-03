const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

// Same magic string as in Python code - from YanHeKT website's main.js
const magic = "1138b69dfef641d9d7ba49137d2d4875";

// 添加内存中的认证令牌变量
let inMemoryAuthToken = "";

const headers = {
  "Origin": "https://www.yanhekt.cn",
  "Referer": "https://www.yanhekt.cn/",
  "xdomain-client": "web_user",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.26",
  "Xdomain-Client": "web_user",
  "Xclient-Version": "v1",
  "Authorization": ""
};

// Update headers with the signature
function updateHeaders() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHash('md5').update(magic + "_v1_" + timestamp).digest('hex');
  
  headers["Xclient-Signature"] = crypto.createHash('md5').update(magic + "_v1_undefined").digest('hex');
  headers["Xclient-Timestamp"] = timestamp;
  
  return { timestamp, signature };
}

// Authentication-related functions
function authPrompt() {
  return [
    "请先在浏览器登录延河课堂",
    "并在延河课堂的地址栏输入 javascript:alert(JSON.parse(localStorage.auth).token)",
    '注意粘贴时浏览器会自动去掉"javascript:"，需要手动补上',
    "或者按F12打开控制台粘贴这段代码",
    "然后将弹出的内容粘贴到这里："
  ].join("\n");
}

function encryptURL(url) {
  const urlList = url.split("/");
  // Insert MD5 hash before the last segment
  urlList.splice(-1, 0, crypto.createHash('md5').update(magic + "_100").digest('hex'));
  return urlList.join("/");
}

function getSignature() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHash('md5').update(magic + "_v1_" + timestamp).digest('hex');
  return { timestamp, signature };
}

async function getToken() {
  updateHeaders();
  try {
    const response = await axios.get("https://cbiz.yanhekt.cn/v1/auth/video/token?id=0", { headers });
    const data = response.data.data;
    if (!data) {
      readAuth();
      const retryResponse = await axios.get("https://cbiz.yanhekt.cn/v1/auth/video/token?id=0", { headers });
      const retryData = retryResponse.data.data;
      if (!retryData) {
        throw new Error("获取Token失败");
      }
      return retryData.token;
    }
    return data.token;
  } catch (error) {
    console.error("Error getting token:", error);
    throw new Error("获取Token失败");
  }
}

function addSignatureForUrl(url, token, timestamp, signature) {
  return `${url}?Xvideo_Token=${token}&Xclient_Timestamp=${timestamp}&Xclient_Signature=${signature}&Xclient_Version=v1&Platform=yhkt_user`;
}

// File operations for auth
function readAuth() {
  // 不再从文件读取，而是从内存变量读取
  if (inMemoryAuthToken) {
    headers["Authorization"] = "Bearer " + inMemoryAuthToken;
    return inMemoryAuthToken;
  }
  return "";
}

function writeAuth(auth) {
  try {
    // 只在内存中保存认证信息，不再写入文件
    headers["Authorization"] = "Bearer " + auth;
    inMemoryAuthToken = auth;
    console.log("认证信息已保存在内存中");
    return true;
  } catch (error) {
    console.error("Error saving auth token:", error);
    return false;
  }
}

function removeAuth() {
  try {
    // 清除内存中的认证信息
    headers["Authorization"] = "";
    inMemoryAuthToken = "";
    console.log("认证信息已从内存中移除");
    return true;
  } catch (error) {
    console.error("Error removing auth token:", error);
    return false;
  }
}

// Test if authentication is valid
async function testAuth(courseID) {
  updateHeaders();
  try {
    const response = await axios.get(
      `https://cbiz.yanhekt.cn/v2/course/session/list?course_id=${courseID}`,
      { headers }
    );
    return !!response.data.data;
  } catch (error) {
    console.error("Error testing auth:", error);
    return false;
  }
}

// Get course information
async function getCourseInfo(courseID) {
  courseID = courseID.trim();
  updateHeaders();

  try {
    const courseResponse = await axios.get(
      `https://cbiz.yanhekt.cn/v1/course?id=${courseID}&with_professor_badges=true`,
      { headers }
    );
    
    const sessionResponse = await axios.get(
      `https://cbiz.yanhekt.cn/v2/course/session/list?course_id=${courseID}`,
      { headers }
    );

    if (courseResponse.data.code !== 0 && courseResponse.data.code !== "0") {
      throw new Error(`课程ID: ${courseID}, ${courseResponse.data.message}。请检查您的课程ID，注意它应该是5位数字，从课程信息界面的链接yanhekt.cn/course/***获取，而不是课程播放界面的链接yanhekt.cn/session/***`);
    }

    const videoList = sessionResponse.data.data;
    const name = courseResponse.data.data.name_zh.trim();
    
    if (!videoList || videoList.length === 0) {
      throw new Error(`该课程(${name})没有视频信息，请检查课程ID是否正确`);
    }

    let professor = "未知教师";
    if (courseResponse.data.data.professors && courseResponse.data.data.professors.length > 0) {
      professor = courseResponse.data.data.professors[0].name.trim();
    }

    return { videoList, name, professor };
  } catch (error) {
    console.error("Error getting course info:", error);
    throw error;
  }
}

// Get audio URL and download audio
async function getAudioUrl(videoId) {
  updateHeaders();
  try {
    const response = await axios.get(
      `https://cbiz.yanhekt.cn/v1/video?id=${videoId}`,
      { headers }
    );
    return response.data.data?.audio || "";
  } catch (error) {
    console.error("Error getting audio URL:", error);
    return "";
  }
}

async function downloadAudio(url, outputPath, name) {
  try {
    const token = await getToken();
    const { timestamp, signature } = getSignature();
    const signedUrl = addSignatureForUrl(url, token, timestamp, signature);
    
    const customHeaders = { ...headers, "Host": "cvideo.yanhekt.cn" };
    
    let response = await axios.get(signedUrl, { 
      headers: customHeaders,
      responseType: 'arraybuffer'
    });
    
    while (response.status !== 200) {
      await new Promise(resolve => setTimeout(resolve, 100));
      response = await axios.get(signedUrl, { 
        headers: customHeaders,
        responseType: 'arraybuffer'
      });
    }
    
    fs.writeFileSync(`${outputPath}/${name}.aac`, response.data);
    return true;
  } catch (error) {
    console.error("Error downloading audio:", error);
    return false;
  }
}

// Extract courseId from URL
function extractCourseId(url) {
  try {
    const coursePattern = /\/course\/(\d+)(?:\/|$)/;
    const match = url.match(coursePattern);
    
    if (match && match[1]) {
      return match[1];
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting course ID:', error);
    return null;
  }
}

// Get auth token from webview
function getAuthFromWebview(webview) {
  return new Promise((resolve) => {
    const script = `
      (function() {
        let token = null;
        try {
          const authData = localStorage.getItem('auth');
          if (authData) {
            const parsed = JSON.parse(authData);
            token = parsed.token;
          }
          
          if (!token) {
            for (const key of ['token', 'accessToken', 'yanhekt_token']) {
              const value = localStorage.getItem(key);
              if (value) {
                token = value.replace(/^"|"$/g, '');
                break;
              }
            }
          }
          
          if (!token) {
            const cookies = document.cookie.split(';');
            const tokenCookie = cookies.find(c => c.trim().startsWith('token='));
            if (tokenCookie) {
              token = tokenCookie.split('=')[1].trim();
            }
          }
        } catch (e) {
          console.error('Error extracting token:', e);
        }
        return token;
      })()
    `;
    
    webview.executeJavaScript(script).then(token => {
      resolve(token);
    }).catch(err => {
      console.error('Error executing script:', err);
      resolve(null);
    });
  });
}

module.exports = {
  headers,
  updateHeaders,
  authPrompt,
  encryptURL,
  getSignature,
  getToken,
  addSignatureForUrl,
  readAuth,
  writeAuth,
  removeAuth,
  testAuth,
  getCourseInfo,
  getAudioUrl,
  downloadAudio,
  extractCourseId,
  getAuthFromWebview
};