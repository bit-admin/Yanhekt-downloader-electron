const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

// Same magic string as in Python code - from YanHeKT website's main.js
const magic = "1138b69dfef641d9d7ba49137d2d4875";

// Add authentication token variable in memory
let inMemoryAuthToken = "";

// Intranet Mode Configuration
let intranetMode = {
  enabled: false,
  videoServerIP: "10.0.34.24", // cvideo.yanhekt.cn
  apiServerIP: "10.0.34.22", // cbiz.yanhekt.cn
  ignoreSSLErrors: true // Ignore SSL certificate errors
};

// Domain to IP Mapping
const domainIPMap = {
  "cvideo.yanhekt.cn": () => intranetMode.videoServerIP,
  "cbiz.yanhekt.cn": () => intranetMode.apiServerIP
};

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
    "请先登录延河课堂，获取认证信息",
    "然后将认证信息粘贴到这里："
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
    const response = await axiosInstance.get("https://cbiz.yanhekt.cn/v1/auth/video/token?id=0", { headers });
    const data = response.data.data;
    if (!data) {
      readAuth();
      const retryResponse = await axiosInstance.get("https://cbiz.yanhekt.cn/v1/auth/video/token?id=0", { headers });
      const retryData = retryResponse.data.data;
      if (!retryData) {
        throw new Error("获取 Token 失败");
      }
      return retryData.token;
    }
    return data.token;
  } catch (error) {
    console.error("Error getting token:", error);
    throw new Error("获取 Token 失败");
  }
}

function addSignatureForUrl(url, token, timestamp, signature) {
  return `${url}?Xvideo_Token=${token}&Xclient_Timestamp=${timestamp}&Xclient_Signature=${signature}&Xclient_Version=v1&Platform=yhkt_user`;
}

// File operations for auth
function readAuth() {
  // No longer reading from a file, but reading from a memory variable instead
  if (inMemoryAuthToken) {
    headers["Authorization"] = "Bearer " + inMemoryAuthToken;
    return inMemoryAuthToken;
  }
  return "";
}

function writeAuth(auth) {
  try {
    // Only save authentication information in memory, no longer write it to a file.
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
    // Clear authentication information from memory
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
    const response = await axiosInstance.get(
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
    const courseResponse = await axiosInstance.get(
      `https://cbiz.yanhekt.cn/v1/course?id=${courseID}&with_professor_badges=true`,
      { headers }
    );
    
    const sessionResponse = await axiosInstance.get(
      `https://cbiz.yanhekt.cn/v2/course/session/list?course_id=${courseID}`,
      { headers }
    );

    if (courseResponse.data.code !== 0 && courseResponse.data.code !== "0") {
      throw new Error(`课程ID: ${courseID}, ${courseResponse.data.message}。课程ID有误，应类似yanhekt.cn/course/***`);
    }

    const videoList = sessionResponse.data.data;
    const name = courseResponse.data.data.name_zh.trim();
    
    if (!videoList || videoList.length === 0) {
      throw new Error(`课程(${name})信息返回错误，请检查是否已取得认证信息，课程ID是否正确`);
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
    const response = await axiosInstance.get(
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
    
    let response = await axiosInstance.get(signedUrl, { 
      headers: customHeaders,
      responseType: 'arraybuffer'
    });
    
    while (response.status !== 200) {
      await new Promise(resolve => setTimeout(resolve, 100));
      response = await axiosInstance.get(signedUrl, { 
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

// Intranet Mode Related Functions
function setIntranetMode(enabled, videoServerIP = "10.0.34.24", apiServerIP = "10.0.34.22") {
  intranetMode.enabled = enabled;
  intranetMode.videoServerIP = videoServerIP;
  intranetMode.apiServerIP = apiServerIP;
  
  if (enabled) {
    console.log(`内网模式已启用:`);
    console.log(`  视频服务器: cvideo.yanhekt.cn -> ${videoServerIP}`);
    console.log(`  API服务器: cbiz.yanhekt.cn -> ${apiServerIP}`);
  } else {
    console.log("内网模式已禁用");
  }
}

function getIntranetMode() {
  return { ...intranetMode };
}

// URL Rewrite Function - Replace Domain with Internal IP but Keep Host Header
function rewriteUrlForIntranet(url) {
  if (!intranetMode.enabled) {
    return url;
  }
  
  try {
    const urlObj = new URL(url);
    const originalHost = urlObj.hostname;
    
    // 检查是否需要重写这个域名
    if (domainIPMap[originalHost]) {
      const ip = domainIPMap[originalHost]();
      if (ip) {
        urlObj.hostname = ip;
        console.log(`URL重写: ${originalHost} -> ${ip}`);
        return urlObj.toString();
      }
    }
    
    return url;
  } catch (error) {
    console.error("URL重写失败:", error);
    return url;
  }
}

// Create an axios instance with intranet mode support
function createAxiosInstance() {
  const instance = axios.create({
    timeout: 30000,
    // Ignore SSL certificate errors in intranet mode
    httpsAgent: intranetMode.enabled && intranetMode.ignoreSSLErrors ? 
      new (require('https').Agent)({ rejectUnauthorized: false }) : undefined
  });
  
  // Request Interceptor - Rewrite URL and Set Correct Host Header
  instance.interceptors.request.use((config) => {
    if (intranetMode.enabled && config.url) {
      const originalUrl = config.url;
      const rewrittenUrl = rewriteUrlForIntranet(originalUrl);
      
      if (rewrittenUrl !== originalUrl) {
        // Extract the original domain as the Host header
        try {
          const originalHost = new URL(originalUrl).hostname;
          config.url = rewrittenUrl;
          config.headers = config.headers || {};
          config.headers['Host'] = originalHost;
          
          console.log(`请求重写: ${originalUrl} -> ${rewrittenUrl} (Host: ${originalHost})`);
        } catch (error) {
          console.error("设置Host头失败:", error);
        }
      }
    }
    
    return config;
  });
  
  return instance;
}

// Replace the default axios call
const axiosInstance = createAxiosInstance();

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
  getAuthFromWebview,
  setIntranetMode,
  getIntranetMode,
  rewriteUrlForIntranet,
  axiosInstance
};