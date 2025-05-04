// Import Electron modules
const { ipcRenderer } = require('electron');

// DOM Element References
const webview = document.getElementById('yanhekt-webview');
const authToken = document.getElementById('auth-token');
const saveAuthBtn = document.getElementById('save-auth-btn');
const autoAuthBtn = document.getElementById('auto-auth-btn');
const authStatus = document.getElementById('auth-status');
const courseIdInput = document.getElementById('course-id');
const getCourseBtn = document.getElementById('get-course-btn');
const extractCourseIdBtn = document.getElementById('extract-course-id-btn');
const courseInfo = document.getElementById('course-info');
const courseName = document.getElementById('course-name');
const courseProfessor = document.getElementById('course-professor');
const videoList = document.getElementById('video-list');
const startDownloadBtn = document.getElementById('start-download-btn');
const downloadAudioCheckbox = document.getElementById('download-audio');
const activeDownloads = document.getElementById('active-downloads');
const openDownloadFolderBtn = document.getElementById('open-download-folder');
// 添加URL显示栏引用
const urlDisplay = document.getElementById('url-display');
// 添加新的DOM元素引用
const downloadPathInput = document.getElementById('download-path');
const selectDownloadPathBtn = document.getElementById('select-download-path-btn');

// Global state
let currentCourse = null;
let selectedVideos = new Set();
let downloads = new Map();
let currentDownloadPath = ''; // 存储当前下载路径

/**
 * 格式化视频文件名
 * 从 "第X周 星期X 第X大节" 转换为 "Week_X_Day"
 * 例如：从 "第6周 星期四 第4大节" 转换为 "Week_6_Thu"
 * @param {string} title - 原始视频标题
 * @returns {string} 格式化后的文件名部分
 */
function formatVideoName(title) {
  // 处理星期几的映射关系
  const dayMap = {
    '星期一': 'Mon',
    '星期二': 'Tue',
    '星期三': 'Wed',
    '星期四': 'Thu',
    '星期五': 'Fri',
    '星期六': 'Sat',
    '星期日': 'Sun',
    '星期天': 'Sun'
  };
  
  let formattedName = title;
  
  // 提取周数
  const weekMatch = title.match(/第(\d+)周/);
  let weekNumber = weekMatch ? weekMatch[1] : '';
  
  // 提取星期几
  let dayName = '';
  for (const chineseDay in dayMap) {
    if (title.includes(chineseDay)) {
      dayName = dayMap[chineseDay];
      break;
    }
  }
  
  // 如果成功提取了周数和星期几，则构建新格式
  if (weekNumber && dayName) {
    formattedName = `Week_${weekNumber}_${dayName}`;
  }
  
  return formattedName;
}

// 安全地加载URL，用于拦截处理
function safeLoadURL(url) {
  if (!url) return;
  
  try {
    // 确保URL是有效的
    new URL(url);
    
    // 加载URL
    webview.src = url;
    console.log('Safely loading URL:', url);
  } catch (error) {
    console.error('Invalid URL:', url, error);
  }
}

// Initialize the application
async function init() {
  // Try to load saved auth token
  const savedAuth = await ipcRenderer.invoke('get-auth');
  if (savedAuth) {
    authToken.value = savedAuth;
    authStatus.textContent = '认证信息已加载';
    authStatus.style.color = 'green';
  }
  
  // 加载并显示当前下载路径
  loadDownloadPath();
  
  // Set up event listeners
  setupEventListeners();
  
  // 设置webview事件处理
  setupWebviewEvents();
}

// 加载并显示下载路径
async function loadDownloadPath() {
  try {
    currentDownloadPath = await ipcRenderer.invoke('get-download-path');
    downloadPathInput.value = currentDownloadPath;
    console.log('当前下载路径:', currentDownloadPath);
  } catch (error) {
    console.error('加载下载路径失败:', error);
    downloadPathInput.value = '加载失败';
  }
}

// 设置webview相关的事件处理
function setupWebviewEvents() {
  // 拦截新窗口打开，在当前webview中打开
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (e.url) {
      console.log('拦截新窗口:', e.url);
      safeLoadURL(e.url);
    }
  });
  
  // 监听导航事件以更新URL显示
  webview.addEventListener('did-navigate', (event) => {
    if (event.url) {
      urlDisplay.textContent = event.url;
    }
  });
  
  // 监听页内导航事件以更新URL显示
  webview.addEventListener('did-navigate-in-page', (event) => {
    if (event.url) {
      urlDisplay.textContent = event.url;
    }
  });
  
  // 页面加载开始时注入早期链接处理脚本
  webview.addEventListener('did-start-loading', async () => {
    // 注入早期链接处理脚本
    webview.executeJavaScript(`
      (function() {
        // 仅在未设置时设置
        if (!window._yanhektEarlyLinkHandlerInstalled) {
          window._yanhektEarlyLinkHandlerInstalled = true;
          
          // 立即覆盖window.open
          const originalWindowOpen = window.open;
          window.open = function(url, name, features) {
            if (url) {
              console.log('Early interception of window.open:', url);
              setTimeout(() => location.href = url, 0);
              return {
                closed: false,
                close: function() {},
                focus: function() {},
                document: document
              };
            }
            return null;
          };
          
          // 添加早期点击处理程序
          document.addEventListener('click', function(event) {
            const link = event.target.closest('a');
            if (!link) return;
            
            if (link.target === '_blank' || event.ctrlKey || event.metaKey) {
              event.preventDefault();
              event.stopPropagation();
              if (link.href) {
                console.log('Early interception of link click:', link.href);
                location.href = link.href;
              }
            }
          }, true);
          
          console.log('Early YanHeKT link handler installed');
        }
      })();
    `).catch(err => console.error('Error injecting early link handler:', err));
  });
  
  // DOM准备好后注入链接处理脚本
  webview.addEventListener('dom-ready', () => {
    console.log('WebView ready');
    
    // 注入链接处理脚本
    webview.executeJavaScript(`
      (function() {
        // 仅设置一次链接处理程序
        if (!window._yanhektLinkHandlerInstalled) {
          window._yanhektLinkHandlerInstalled = true;
          
          // 覆盖window.open
          const originalWindowOpen = window.open;
          window.open = function(url, name, features) {
            if (url) {
              console.log('Intercepted window.open:', url);
              // 使用location.href在同一窗口中导航
              setTimeout(() => location.href = url, 0);
              
              // 返回模拟窗口对象
              return {
                closed: false,
                close: function() {},
                focus: function() {},
                document: document
              };
            }
            return null;
          };
          
          // 处理target="_blank"链接
          document.addEventListener('click', function(event) {
            const link = event.target.closest('a');
            if (!link) return;
            
            // 处理_blank链接或cmd/ctrl+点击
            if (link.target === '_blank' || event.ctrlKey || event.metaKey) {
              event.preventDefault();
              event.stopPropagation();
              
              if (link.href) {
                console.log('Intercepted link click:', link.href);
                location.href = link.href;
              }
            }
          }, true);
          
          console.log('YanHeKT link handler installed');
        }
      })();
    `).catch(err => console.error('Error injecting link handler:', err));
  });
}

// Set up all event listeners
function setupEventListeners() {
  // Authentication section
  saveAuthBtn.addEventListener('click', saveAuth);
  autoAuthBtn.addEventListener('click', autoExtractAuth);
  
  // Course section
  getCourseBtn.addEventListener('click', getCourseInfo);
  extractCourseIdBtn.addEventListener('click', extractCourseId);
  
  // Download section
  startDownloadBtn.addEventListener('click', startDownload);
  openDownloadFolderBtn.addEventListener('click', openDownloadFolder);
  
  // 添加下载路径选择按钮事件监听
  selectDownloadPathBtn.addEventListener('click', selectDownloadPath);
  
  // Set up IPC event listeners for download progress and status updates
  ipcRenderer.on('download-progress', (event, data) => {
    updateDownloadProgress(data);
  });
  
  ipcRenderer.on('download-status', (event, data) => {
    updateDownloadStatus(data);
  });
  
  ipcRenderer.on('download-error', (event, data) => {
    handleDownloadError(data);
  });
  
  // Make sure webview is ready before trying to interact with it
  webview.addEventListener('dom-ready', () => {
    console.log('WebView ready');
    // Uncomment to debug webview
    // webview.openDevTools();
  });
}

// Save authentication token
async function saveAuth() {
  const token = authToken.value.trim();
  if (!token) {
    authStatus.textContent = '请输入认证令牌';
    authStatus.style.color = 'red';
    return;
  }
  
  authStatus.textContent = '正在保存认证信息...';
  
  const result = await ipcRenderer.invoke('save-auth', token);
  if (result) {
    authStatus.textContent = '认证信息已保存';
    authStatus.style.color = 'green';
  } else {
    authStatus.textContent = '保存认证信息失败';
    authStatus.style.color = 'red';
  }
}

// Auto extract auth token from webview
async function autoExtractAuth() {
  authStatus.textContent = '正在获取认证信息...';
  
  // Run script in webview to extract auth token
  try {
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
    
    const extractedToken = await webview.executeJavaScript(script);
    
    if (extractedToken) {
      authToken.value = extractedToken;
      await saveAuth();
    } else {
      authStatus.textContent = '无法从网页获取认证信息，请先登录延河课堂';
      authStatus.style.color = 'red';
    }
  } catch (error) {
    console.error('Error executing script:', error);
    authStatus.textContent = '获取认证信息失败: ' + error.message;
    authStatus.style.color = 'red';
  }
}

// Get course information
async function getCourseInfo() {
  const courseId = courseIdInput.value.trim();
  if (!courseId) {
    alert('请输入课程 ID');
    return;
  }
  
  // Test if auth is valid for this course
  const isAuthValid = await ipcRenderer.invoke('test-auth', courseId);
  if (!isAuthValid) {
    alert('认证信息无效，请重新获取认证信息');
    return;
  }
  
  try {
    const courseData = await ipcRenderer.invoke('get-course-info', courseId);
    
    if (courseData.error) {
      alert('获取课程信息失败: ' + courseData.error);
      return;
    }
    
    displayCourseInfo(courseData);
  } catch (error) {
    console.error('Error getting course info:', error);
    alert('获取课程信息失败: ' + error.message);
  }
}

// Extract course ID from webview URL
async function extractCourseId() {
  try {
    const currentUrl = await webview.executeJavaScript('window.location.href');
    
    // Extract course ID from URL using regex
    const coursePattern = /\/course\/(\d+)(?:\/|$)/;
    const match = currentUrl.match(coursePattern);
    
    if (match && match[1]) {
      courseIdInput.value = match[1];
      getCourseInfo();
    } else {
      alert('未在当前页面找到课程 ID，请访问课程详情页');
    }
  } catch (error) {
    console.error('Error extracting course ID:', error);
    alert('提取课程 ID 失败: ' + error.message);
  }
}

// Display course information in the UI
function displayCourseInfo(courseData) {
  currentCourse = courseData;
  
  // 设置课程名称，如果过长则使用省略号
  courseName.textContent = courseData.name;
  courseName.title = courseData.name; // 添加完整名称作为提示
  
  // 检查课程名是否溢出并添加省略号
  setTimeout(() => {
    if (courseName.scrollWidth > courseName.clientWidth) {
      const nameLength = courseData.name.length;
      const estimatedVisibleChars = Math.floor(nameLength * (courseName.clientWidth / courseName.scrollWidth)) - 2;
      if (estimatedVisibleChars > 0) {
        courseName.textContent = courseData.name.substring(0, estimatedVisibleChars) + "……";
        courseName.classList.add('overflow');
      }
    }
  }, 0);
  
  courseProfessor.textContent = `教师: ${courseData.professor}`;
  
  // Clear and populate video list
  videoList.innerHTML = '';
  courseData.videoList.forEach((video, index) => {
    const videoItem = document.createElement('div');
    videoItem.className = 'video-item';
    videoItem.dataset.index = index;
    videoItem.textContent = `${video.title}`;
    
    videoItem.addEventListener('click', () => {
      if (videoItem.classList.contains('selected')) {
        videoItem.classList.remove('selected');
        selectedVideos.delete(index);
      } else {
        videoItem.classList.add('selected');
        selectedVideos.add(index);
      }
      
      startDownloadBtn.disabled = selectedVideos.size === 0;
    });
    
    videoList.appendChild(videoItem);
  });
  
  // Show course info section
  courseInfo.style.display = 'block';
  startDownloadBtn.disabled = true;
  selectedVideos.clear();
}

// Start downloading selected videos
async function startDownload() {
  if (selectedVideos.size === 0) {
    alert('请选择要下载的视频');
    return;
  }
  
  const videoSource = document.querySelector('input[name="video-source"]:checked').value;
  const downloadAudio = downloadAudioCheckbox.checked;
  
  // For each selected video, start a download
  for (const index of selectedVideos) {
    const video = currentCourse.videoList[index];
    // 使用新的命名格式：课程名_Week_X_Day
    const formattedTitle = formatVideoName(video.title);
    const videoName = `${currentCourse.name}_${formattedTitle}`;
    
    // Determine video URL based on selected source
    let videoUrl;
    if (videoSource === 'camera') {
      videoUrl = video.videos[0].main;
      console.log('Using camera video URL:', videoUrl);
    } else {
      videoUrl = video.videos[0].vga;
      console.log('Using screen recording URL:', videoUrl);
    }
    
    // Get audio URL if needed
    let audioUrl = '';
    if (downloadAudio && video.video_ids && video.video_ids.length > 0) {
      audioUrl = await ipcRenderer.invoke('get-audio-url', video.video_ids[0]);
    }
    
    // Start the download process
    const response = await ipcRenderer.invoke('start-download', {
      videoUrl,
      workDir: currentDownloadPath || `output/${currentCourse.name}-${videoSource === 'camera' ? 'video' : 'screen'}`,
      name: videoName,
      audioUrl,
      videoId: video.video_ids ? video.video_ids[0] : null,
      downloadAudio
    });
    
    if (response.success) {
      // Create download item in UI
      createDownloadItem(response.id, videoName);
    } else {
      alert(`开始下载失败: ${response.error}`);
    }
  }
}

// Create a download item in the UI
function createDownloadItem(id, name) {
  const downloadItem = document.createElement('div');
  downloadItem.className = 'download-item';
  downloadItem.id = `download-${id}`;
  
  const nameElement = document.createElement('div');
  nameElement.className = 'download-item-name';
  nameElement.textContent = name;
  
  const statusElement = document.createElement('span');
  statusElement.className = 'status status-downloading';
  statusElement.textContent = '下载中';
  nameElement.appendChild(statusElement);
  
  const progressContainer = document.createElement('div');
  progressContainer.className = 'progress-bar';
  
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar-fill';
  progressBar.style.width = '0%';
  progressContainer.appendChild(progressBar);
  
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '取消';
  cancelBtn.style.marginTop = '5px';
  cancelBtn.addEventListener('click', () => {
    cancelDownload(id);
  });
  
  downloadItem.appendChild(nameElement);
  downloadItem.appendChild(progressContainer);
  downloadItem.appendChild(cancelBtn);
  
  activeDownloads.appendChild(downloadItem);
  
  // Store download info
  downloads.set(id, {
    name,
    status: 'downloading',
    progress: 0,
    element: downloadItem
  });
}

// Update download progress in UI
function updateDownloadProgress(data) {
  const { id, progress, status } = data;
  const download = downloads.get(id);
  
  if (!download) return;
  
  download.progress = progress;
  
  // Update progress bar
  const progressBar = download.element.querySelector('.progress-bar-fill');
  progressBar.style.width = `${progress}%`;
  
  // Update status text
  const statusElement = download.element.querySelector('.status');
  
  if (status === 0) { // Downloading TS files
    statusElement.textContent = `下载中 ${progress}%`;
    statusElement.className = 'status status-downloading';
  } else if (status === 1) { // Converting to MP4
    statusElement.textContent = `转换中 ${progress}%`;
    statusElement.className = 'status status-converting';
    download.status = 'converting';
  } else if (status === 2) { // Completed
    statusElement.textContent = '已完成';
    statusElement.className = 'status status-completed';
    download.status = 'completed';
    
    // Remove cancel button
    const cancelBtn = download.element.querySelector('button');
    if (cancelBtn) {
      cancelBtn.remove();
    }
  }
}

// Update download status based on events
function updateDownloadStatus(data) {
  const { id, status } = data;
  const download = downloads.get(id);
  
  if (!download) return;
  
  const statusElement = download.element.querySelector('.status');
  
  if (status === 'downloading-audio') {
    statusElement.textContent = '下载音频';
    statusElement.className = 'status status-downloading';
  } else if (status === 'audio-complete') {
    statusElement.textContent = '已完成';
    statusElement.className = 'status status-completed';
    download.status = 'completed';
    
    // Remove cancel button
    const cancelBtn = download.element.querySelector('button');
    if (cancelBtn) {
      cancelBtn.remove();
    }
  }
}

// Handle download error
function handleDownloadError(data) {
  const { id, error } = data;
  const download = downloads.get(id);
  
  if (!download) return;
  
  const statusElement = download.element.querySelector('.status');
  statusElement.textContent = '下载失败';
  statusElement.className = 'status status-error';
  download.status = 'error';
  
  // Add error message
  const errorElement = document.createElement('div');
  errorElement.textContent = `错误: ${error}`;
  errorElement.style.color = 'red';
  errorElement.style.fontSize = '12px';
  errorElement.style.marginTop = '5px';
  
  download.element.appendChild(errorElement);
}

// Cancel an active download
async function cancelDownload(id) {
  const result = await ipcRenderer.invoke('cancel-download', id);
  
  if (result.success) {
    const download = downloads.get(id);
    if (download) {
      const statusElement = download.element.querySelector('.status');
      statusElement.textContent = '已取消';
      statusElement.className = 'status status-error';
      download.status = 'cancelled';
      
      // Remove cancel button
      const cancelBtn = download.element.querySelector('button');
      if (cancelBtn) {
        cancelBtn.remove();
      }
    }
  } else {
    alert('取消下载失败: ' + result.error);
  }
}

// 选择下载路径
async function selectDownloadPath() {
  try {
    const result = await ipcRenderer.invoke('select-download-path');
    
    if (result.success) {
      currentDownloadPath = result.path;
      downloadPathInput.value = currentDownloadPath;
      
      // 显示成功消息
      const notification = document.createElement('div');
      notification.textContent = '下载路径已更改';
      notification.style.color = 'green';
      notification.style.fontSize = '0.9em';
      notification.style.marginTop = '5px';
      
      // 移除之前的通知
      const oldNotification = downloadPathInput.parentNode.querySelector('.path-notification');
      if (oldNotification) {
        oldNotification.remove();
      }
      
      notification.className = 'path-notification';
      downloadPathInput.parentNode.appendChild(notification);
      
      // 3秒后移除通知
      setTimeout(() => {
        notification.remove();
      }, 3000);
    }
  } catch (error) {
    console.error('选择下载路径失败:', error);
  }
}

// Open the download folder
async function openDownloadFolder() {
  await ipcRenderer.invoke('open-output-folder');
}

// Initialize the app when the DOM is ready
document.addEventListener('DOMContentLoaded', init);