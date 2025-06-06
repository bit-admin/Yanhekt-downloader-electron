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
const selectAllBtn = document.getElementById('select-all-btn');
const startDownloadBtn = document.getElementById('start-download-btn');
const downloadAudioCheckbox = document.getElementById('download-audio');
const activeDownloads = document.getElementById('active-downloads');
const openDownloadFolderBtn = document.getElementById('open-download-folder');
const expandDownloadsBtn = document.getElementById('expand-downloads-btn');
const closeDownloadsBtn = document.getElementById('close-downloads-btn');
const downloadsPopup = document.getElementById('downloads-popup');
const urlDisplay = document.getElementById('url-display');
const downloadPathInput = document.getElementById('download-path');
const downloadPathStatus = document.getElementById('download-path-status');
const selectDownloadPathBtn = document.getElementById('select-download-path-btn');
const downloadCountBadge = document.getElementById('download-count-badge');
const concurrentLimitSelect = document.getElementById('concurrent-limit');
const activeCountSpan = document.getElementById('active-count');
const queuedCountSpan = document.getElementById('queued-count');
const clearCompletedBtn = document.getElementById('clear-completed-btn');

// Global state
let currentCourse = null;
let selectedVideos = new Set();
let downloads = new Map();
let currentDownloadPath = '';
let activeDownloadCount = 0; // Track active download count

// Download queue system
let downloadQueue = [];
let activeDownloadSlots = 0;
let maxConcurrentDownloads = 5; // Default concurrent limit

/**
 * Update the download count badge
 */
function updateDownloadBadge() {
  // Count all pending downloads (queued + downloading + converting)
  activeDownloadCount = Array.from(downloads.values()).filter(
    download => download.status === 'queued' || download.status === 'downloading' || download.status === 'converting'
  ).length;
  
  // Update badge text
  downloadCountBadge.textContent = activeDownloadCount;
  
  // Toggle badge visibility
  if (activeDownloadCount > 0) {
    downloadCountBadge.classList.add('visible');
  } else {
    downloadCountBadge.classList.remove('visible');
  }
}

/**
 * Update queue information display
 */
function updateQueueInfo() {
  activeCountSpan.textContent = activeDownloadSlots;
  queuedCountSpan.textContent = downloadQueue.length;
  
  // Update clear completed button state
  updateClearCompletedButton();
}

/**
 * Process download queue - start next download if slots available
 */
async function processDownloadQueue() {
  while (downloadQueue.length > 0 && activeDownloadSlots < maxConcurrentDownloads) {
    const downloadTask = downloadQueue.shift();
    activeDownloadSlots++;
    
    updateQueueInfo();
    
    try {
      // Start the actual download
      const response = await ipcRenderer.invoke('start-download', downloadTask.options);
      
      if (response.success) {
        // Update download item status
        const download = downloads.get(downloadTask.id);
        if (download) {
          download.status = 'downloading';
          const statusElement = download.element.querySelector('.status');
          statusElement.textContent = '下载中';
          statusElement.className = 'status status-downloading';
        }
        
        // Store the real download ID
        downloadTask.realId = response.id;
        downloads.set(response.id, downloads.get(downloadTask.id));
        downloads.delete(downloadTask.id);
      } else {
        // Download failed to start
        const download = downloads.get(downloadTask.id);
        if (download) {
          download.status = 'error';
          const statusElement = download.element.querySelector('.status');
          statusElement.textContent = '启动失败';
          statusElement.className = 'status status-error';
        }
        
        activeDownloadSlots--;
        updateQueueInfo();
      }
    } catch (error) {
      console.error('Failed to start download:', error);
      activeDownloadSlots--;
      updateQueueInfo();
    }
  }
}

/**
 * Format video file name
 * Convert from "Week X Day X Session X" to "Week_X_Day"
 * For example: from "Week 6 Thursday Session 4" to "Week_6_Thu"
 * @param {string} title - Original video title
 * @returns {string} Formatted file name part
 */
function formatVideoName(title) {
  // Handling the mapping relationship of days of the week
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
  
  // Extract week number
  const weekMatch = title.match(/第(\d+)周/);
  let weekNumber = weekMatch ? weekMatch[1] : '';
  
  // Extract the day of the week
  let dayName = '';
  for (const chineseDay in dayMap) {
    if (title.includes(chineseDay)) {
      dayName = dayMap[chineseDay];
      break;
    }
  }
  
  // If the week number and day of the week are successfully extracted, construct a new format.
  if (weekNumber && dayName) {
    formattedName = `Week_${weekNumber}_${dayName}`;
  }
  
  return formattedName;
}

// Safely load URL for interception processing
function safeLoadURL(url) {
  if (!url) return;
  
  try {
    // Ensure the URL is valid
    new URL(url);
    
    // Load URL
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
  
  // Load and display the current download path
  loadDownloadPath();
  
  // Set up event listeners
  setupEventListeners();
  
  // Set up webview event handling
  setupWebviewEvents();
  
  // Initialize download badge (hidden by default)
  updateDownloadBadge();
  
  // Initialize queue info display
  updateQueueInfo();
}

// Load and display download path
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

// Set up event handling related to WebView
function setupWebviewEvents() {
  // Block new window from opening, open in the current webview
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (e.url) {
      console.log('拦截新窗口:', e.url);
      safeLoadURL(e.url);
    }
  });
  
  // Listen for navigation events to update URL display
  webview.addEventListener('did-navigate', (event) => {
    if (event.url) {
      urlDisplay.textContent = event.url;
    }
  });
  
  // Listen for in-page navigation events to update the URL display
  webview.addEventListener('did-navigate-in-page', (event) => {
    if (event.url) {
      urlDisplay.textContent = event.url;
    }
  });
  
  // Inject early link processing script at the start of page loading
  webview.addEventListener('did-start-loading', async () => {
    // Inject early link processing script
    webview.executeJavaScript(`
      (function() {
        // Set only when not set
        if (!window._yanhektEarlyLinkHandlerInstalled) {
          window._yanhektEarlyLinkHandlerInstalled = true;
          
          // Immediately overwrite window.open
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
          
          // Add early click handler
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
  
  // Inject link processing script after DOM is ready
  webview.addEventListener('dom-ready', () => {
    console.log('WebView ready');
    
    // Inject link processing script
    webview.executeJavaScript(`
      (function() {
        // Set the link handler only once
        if (!window._yanhektLinkHandlerInstalled) {
          window._yanhektLinkHandlerInstalled = true;
          
          // overwrite window.open
          const originalWindowOpen = window.open;
          window.open = function(url, name, features) {
            if (url) {
              console.log('Intercepted window.open:', url);
              // Use location.href to navigate in the same window
              setTimeout(() => location.href = url, 0);
              
              // Return simulated window object
              return {
                closed: false,
                close: function() {},
                focus: function() {},
                document: document
              };
            }
            return null;
          };
          
          // Handling target="_blank" links
          document.addEventListener('click', function(event) {
            const link = event.target.closest('a');
            if (!link) return;
            
            // Handle _blank links or cmd/ctrl+click
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
  selectAllBtn.addEventListener('click', toggleSelectAllVideos);
  startDownloadBtn.addEventListener('click', startDownload);
  openDownloadFolderBtn.addEventListener('click', openDownloadFolder);
  
  // Expand and close events of the download list popup layer
  expandDownloadsBtn.addEventListener('click', toggleDownloadsPopup);
  closeDownloadsBtn.addEventListener('click', toggleDownloadsPopup);
  
  // Add download path selection button event listener
  selectDownloadPathBtn.addEventListener('click', selectDownloadPath);
  
  // Add clear completed downloads button event listener
  clearCompletedBtn.addEventListener('click', clearCompletedDownloads);
  
  // Add concurrent limit change event listener
  concurrentLimitSelect.addEventListener('change', (e) => {
    maxConcurrentDownloads = parseInt(e.target.value);
    console.log('并发限制更新为:', maxConcurrentDownloads);
    // Process queue in case new slots are available
    processDownloadQueue();
  });
  
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
      authStatus.textContent = '无法获取认证信息，请先登录延河课堂';
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
  
  // Set the course name, use an ellipsis if it is too long
  courseName.textContent = courseData.name;
  courseName.title = courseData.name; // Add full name as a prompt
  
  // Check if the course name overflows and add an ellipsis
  setTimeout(() => {
    if (courseName.scrollWidth > courseName.clientWidth) {
      const nameLength = courseData.name.length;
      const estimatedVisibleChars = Math.floor(nameLength * (courseName.clientWidth / courseName.scrollWidth)) - 2;
      if (estimatedVisibleChars > 0) {
        courseName.textContent = courseData.name.substring(0, estimatedVisibleChars) + "…";
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

// Select or deselect all videos in the list
function toggleSelectAllVideos() {
  if (!currentCourse || !currentCourse.videoList || currentCourse.videoList.length === 0) return;
  
  const totalVideos = currentCourse.videoList.length;
  const allSelected = selectedVideos.size === totalVideos;
  
  // Toggle between select all and deselect all
  if (allSelected) {
    // Deselect all videos
    selectedVideos.clear();
    selectAllBtn.textContent = '全选';
    
    // Update UI to show deselected videos
    const videoItems = videoList.querySelectorAll('.video-item');
    videoItems.forEach(item => {
      item.classList.remove('selected');
    });
  } else {
    // Select all videos
    selectedVideos.clear(); // Clear first to avoid duplicates
    currentCourse.videoList.forEach((_, index) => {
      selectedVideos.add(index);
    });
    selectAllBtn.textContent = '取消全选';
    
    // Update UI to show selected videos
    const videoItems = videoList.querySelectorAll('.video-item');
    videoItems.forEach(item => {
      item.classList.add('selected');
    });
  }
  
  // Enable/disable the download button
  startDownloadBtn.disabled = selectedVideos.size === 0;
}

// Start downloading selected videos
async function startDownload() {
  if (selectedVideos.size === 0) {
    alert('请选择要下载的视频');
    return;
  }
  
  const videoSource = document.querySelector('input[name="video-source"]:checked').value;
  const downloadAudio = downloadAudioCheckbox.checked;
  
  // For each selected video, add to download queue
  for (const index of selectedVideos) {
    const video = currentCourse.videoList[index];
    // Use the new naming format: CourseName_Week_X_Day
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
    
    // Create a unique temporary ID for the queue item
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create download item in UI with queued status
    createDownloadItem(tempId, videoName, true); // true means queued
    
    // Add to download queue
    const downloadTask = {
      id: tempId,
      options: {
        videoUrl,
        workDir: currentDownloadPath || `output/${currentCourse.name}-${videoSource === 'camera' ? 'video' : 'screen'}`,
        name: videoName,
        audioUrl,
        videoId: video.video_ids ? video.video_ids[0] : null,
        downloadAudio
      }
    };
    
    downloadQueue.push(downloadTask);
  }
  
  // Update queue info and start processing
  updateQueueInfo();
  processDownloadQueue();
}

// Create a download item in the UI
function createDownloadItem(id, name, isQueued = false) {
  const downloadItem = document.createElement('div');
  downloadItem.className = 'download-item';
  downloadItem.id = `download-${id}`;
  
  const nameElement = document.createElement('div');
  nameElement.className = 'download-item-name';
  nameElement.textContent = name;
  
  const statusElement = document.createElement('span');
  if (isQueued) {
    statusElement.className = 'status status-queued';
    statusElement.textContent = '队列中';
  } else {
    statusElement.className = 'status status-downloading';
    statusElement.textContent = '下载中';
  }
  nameElement.appendChild(statusElement);
  
  const progressContainer = document.createElement('div');
  progressContainer.className = 'progress-container';
  
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  
  const progressBarFill = document.createElement('div');
  progressBarFill.className = 'progress-bar-fill';
  progressBarFill.style.width = '0%';
  progressBar.appendChild(progressBarFill);
  
  // Create SVG cancel icon
  const cancelIcon = document.createElement('div');
  cancelIcon.className = 'cancel-icon';
  cancelIcon.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  cancelIcon.title = '取消下载';
  cancelIcon.addEventListener('click', () => {
    cancelDownload(id);
  });
  
  // Add progress bar and cancel icon to container
  progressContainer.appendChild(progressBar);
  progressContainer.appendChild(cancelIcon);
  
  downloadItem.appendChild(nameElement);
  downloadItem.appendChild(progressContainer);
  
  activeDownloads.appendChild(downloadItem);
  
  // Store download info
  downloads.set(id, {
    name,
    status: isQueued ? 'queued' : 'downloading',
    progress: 0,
    element: downloadItem
  });
  
  // Update badge after adding a new download
  updateDownloadBadge();
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
    const cancelBtn = download.element.querySelector('.cancel-icon');
    if (cancelBtn) {
      cancelBtn.remove();
    }
    
    // Release download slot and process queue
    activeDownloadSlots--;
    updateQueueInfo();
    processDownloadQueue();
    
    // Update badge count since a download has completed
    updateDownloadBadge();
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
    const cancelBtn = download.element.querySelector('.cancel-icon');
    if (cancelBtn) {
      cancelBtn.remove();
    }
    
    // Release download slot and process queue
    activeDownloadSlots--;
    updateQueueInfo();
    processDownloadQueue();
    
    // Update badge count since a download has completed
    updateDownloadBadge();
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
  
  // Release download slot if this was an active download
  if (activeDownloadSlots > 0) {
    activeDownloadSlots--;
    updateQueueInfo();
    processDownloadQueue();
  }
  
  // Update badge count since a download has errored
  updateDownloadBadge();
}

// Cancel an active download
async function cancelDownload(id) {
  const download = downloads.get(id);
  if (!download) return;
  
  // Check if this is a queued download
  if (download.status === 'queued') {
    // Remove from queue
    downloadQueue = downloadQueue.filter(task => task.id !== id);
    
    // Remove from UI
    downloads.delete(id);
    download.element.remove();
    
    updateQueueInfo();
    updateDownloadBadge();
    return;
  }
  
  // For active downloads, invoke the cancel on the main process
  const result = await ipcRenderer.invoke('cancel-download', id);
  
  if (result.success) {
    const statusElement = download.element.querySelector('.status');
    statusElement.textContent = '已取消';
    statusElement.className = 'status status-error';
    download.status = 'cancelled';
    
    // Remove cancel button
    const cancelBtn = download.element.querySelector('.cancel-icon');
    if (cancelBtn) {
      cancelBtn.remove();
    }
    
    // Release download slot and process queue
    if (activeDownloadSlots > 0) {
      activeDownloadSlots--;
      updateQueueInfo();
      processDownloadQueue();
    }
    
    // Update badge count since a download was canceled
    updateDownloadBadge();
  } else {
    alert('取消下载失败: ' + result.error);
  }
}

// Toggle the downloads popup visibility
function toggleDownloadsPopup() {
  // Toggle the 'show' class on the downloads popup
  downloadsPopup.classList.toggle('show');
  
  // Update the direction of the button icon (actually achieved through CSS transformation)
  if (downloadsPopup.classList.contains('show')) {
    // If the pop-up window is currently displayed, change the button direction
    expandDownloadsBtn.classList.add('rotated');
  } else {
    // If the pop-up window is currently hidden, restore the button direction
    expandDownloadsBtn.classList.remove('rotated');
  }
}

// Choose download path
async function selectDownloadPath() {
  try {
    const result = await ipcRenderer.invoke('select-download-path');
    
    if (result.success) {
      currentDownloadPath = result.path;
      downloadPathInput.value = currentDownloadPath;
      
      // Show success message
      downloadPathStatus.textContent = '下载路径已更改';
      downloadPathStatus.style.color = 'green';
      
      // Remove notification after 3 seconds
      setTimeout(() => {
        downloadPathStatus.textContent = '';
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

/**
 * Update clear completed button state
 */
function updateClearCompletedButton() {
  const completedCount = Array.from(downloads.values()).filter(
    download => download.status === 'completed' || download.status === 'error' || download.status === 'cancelled'
  ).length;
  
  if (completedCount > 0) {
    clearCompletedBtn.disabled = false;
    clearCompletedBtn.style.opacity = '1';
    clearCompletedBtn.title = `清除 ${completedCount} 个已完成项`;
  } else {
    clearCompletedBtn.disabled = true;
    clearCompletedBtn.style.opacity = '0.5';
    clearCompletedBtn.title = '暂无已完成项';
  }
}

/**
 * Clear all completed downloads from the list
 */
function clearCompletedDownloads() {
  const completedDownloads = Array.from(downloads.entries()).filter(
    ([id, download]) => download.status === 'completed' || download.status === 'error' || download.status === 'cancelled'
  );
  
  // Remove completed downloads from UI and downloads map
  completedDownloads.forEach(([id, download]) => {
    download.element.remove();
    downloads.delete(id);
  });
  
  // Update UI elements
  updateDownloadBadge();
  updateQueueInfo();
  
  console.log(`已清除 ${completedDownloads.length} 个已完成的下载项`);
}

// Clear completed downloads button event listener
clearCompletedBtn.addEventListener('click', clearCompletedDownloads);