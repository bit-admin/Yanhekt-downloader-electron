const { app, BrowserWindow, ipcMain, dialog, shell,  Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { M3u8Downloader } = require('../shared/m3u8dl');
const utils = require('../shared/utils');

app.setName('Yanhekt Downloader');  

// 保存用户设置的默认路径
let userDownloadPath = '';

// 获取默认下载路径
function getDefaultDownloadPath() {
  if (userDownloadPath) {
    return userDownloadPath;
  }
  
  // 用户下载目录
  const downloadDir = app.getPath('downloads');
  const yanheDir = path.join(downloadDir, 'Yanhe');
  
  // 确保目录存在
  if (!fs.existsSync(yanheDir)) {
    try {
      fs.mkdirSync(yanheDir, { recursive: true });
    } catch (error) {
      console.error('创建默认下载目录失败:', error);
      return downloadDir; // 如果创建失败，返回下载目录
    }
  }
  
  return yanheDir;
}

// 保存用户设置的下载路径
function saveUserDownloadPath(newPath) {
  if (!newPath) return false;
  
  try {
    // 确保路径存在
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    
    userDownloadPath = newPath;
    
    // 可以将设置保存到配置文件
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const config = { downloadPath: newPath };
    fs.writeFileSync(configPath, JSON.stringify(config));
    
    return true;
  } catch (error) {
    console.error('保存下载路径失败:', error);
    return false;
  }
}

// 加载用户设置
function loadUserSettings() {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.downloadPath && fs.existsSync(config.downloadPath)) {
        userDownloadPath = config.downloadPath;
      }
    }
  } catch (error) {
    console.error('加载用户设置失败:', error);
  }
}

// Keep a global reference of the window object
let mainWindow;

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true, // Makes width/height dimensions apply to the web content area
    backgroundColor: '#f5f5f5',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      webSecurity: false, // Required for Cross-Origin requests
      zoomFactor: 1.0 // Prevents automatic scaling
    }
  });

  // Ensure window size is as expected after creation
  mainWindow.once('ready-to-show', () => {
    // Force the window to be the correct size
    mainWindow.setContentSize(1200, 800, false);
  });

  // Load the application's HTML file
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development mode
  // mainWindow.webContents.openDevTools();

  // Emitted when the window is closed
  mainWindow.on('closed', function() {
    mainWindow = null;
  });

  // 加载用户设置
  loadUserSettings();
  
  // 确保下载目录存在
  const outputDir = getDefaultDownloadPath();
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        process.platform === 'darwin' 
          ? { role: 'about', label: 'About ' + app.name } 
          : { label: 'About', click: () => app.showAboutPanel() },
        { type: 'separator' },
        // macOS-specific project with conditional judgment
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
        ] : []),
        { type: 'separator' },
        { role: 'quit', label: 'Quit' }
      ]
    },
    {
      role: 'help',
      label: 'Help',
      submenu: [
        {
          label: '访问 GitHub 主页',
          click: async () => {
            await shell.openExternal('https://github.com/bit-admin/Yanhekt-downloader-electron');
          }
        },
        { type: 'separator' },
        {
          label: '想要从课程视频中获取课件？',
          click: async () => {
            await shell.openExternal('https://github.com/bit-admin/AutoSlides-extractor');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Create window when Electron has finished initializing
app.whenReady().then(() => {
  createWindow();
  createApplicationMenu();
});

// Quit when all windows are closed
app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function() {
  if (mainWindow === null) {
    createWindow();
  }
});

// Store active downloads
const activeDownloads = new Map();

// IPC handlers for renderer process communication
ipcMain.handle('get-auth', async () => {
  return utils.readAuth();
});

ipcMain.handle('save-auth', async (event, auth) => {
  return utils.writeAuth(auth);
});

ipcMain.handle('test-auth', async (event, courseId) => {
  return utils.testAuth(courseId);
});

ipcMain.handle('get-course-info', async (event, courseId) => {
  try {
    return await utils.getCourseInfo(courseId);
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('start-download', async (event, options) => {
  const { videoUrl, workDir, name, audioUrl, videoId, downloadAudio } = options;
  
  // 使用用户设置的下载路径或默认路径
  const basePath = getDefaultDownloadPath();
  
  // 修复: 不再重复拼接路径
  // 如果workDir已经是完整路径，就直接使用；否则拼接基础路径和工作目录
  let outputPath;
  if (path.isAbsolute(workDir)) {
    outputPath = workDir;
  } else {
    // 避免路径重复，只拼接简单的子目录名称
    // 例如: workDir为"质性研究方法-screen"而不是完整路径
    outputPath = path.join(basePath, workDir);
  }
  
  console.log('下载路径:', outputPath);
  
  // Create a unique ID for this download
  const downloadId = `download_${Date.now()}`;
  
  try {
    // Create the download directory if it doesn't exist
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
    
    // Create a new downloader for this video
    const downloader = new M3u8Downloader(
      videoUrl, 
      workDir, // 原始workDir参数
      name, 
      32, 
      99, 
      (downloaded, total, status) => {
        // Send progress updates to the renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            progress: Math.floor((downloaded / total) * 100),
            status: status // 0: downloading, 1: converting, 2: completed
          });
        }
      },
      basePath // 传递基础路径
    );
    
    // Store the downloader reference
    activeDownloads.set(downloadId, {
      downloader,
      audioUrl,
      videoId,
      downloadAudio,
      outputPath,
      name
    });
    
    // Start the download in the background
    downloader.start().then(async () => {
      // If we need to download audio too
      if (downloadAudio && audioUrl) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-status', {
            id: downloadId,
            status: 'downloading-audio'
          });
        }
        
        await utils.downloadAudio(audioUrl, outputPath, name);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-status', {
            id: downloadId,
            status: 'audio-complete'
          });
        }
      }
      
      // Clean up the download reference
      activeDownloads.delete(downloadId);
    }).catch(error => {
      console.error('Download failed:', error);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-error', {
          id: downloadId,
          error: error.message
        });
      }
      
      activeDownloads.delete(downloadId);
    });
    
    return { id: downloadId, success: true };
  } catch (error) {
    console.error('Error starting download:', error);
    return { error: error.message, success: false };
  }
});

ipcMain.handle('cancel-download', async (event, downloadId) => {
  const download = activeDownloads.get(downloadId);
  if (download) {
    download.downloader.stop();
    activeDownloads.delete(downloadId);
    return { success: true };
  }
  return { success: false, error: 'Download not found' };
});

ipcMain.handle('open-output-folder', async () => {
  const outputDir = getDefaultDownloadPath();
  shell.openPath(outputDir);
  return { success: true };
});

ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  
  return null;
});

// 添加新的IPC处理程序
ipcMain.handle('get-download-path', async () => {
  return getDefaultDownloadPath();
});

ipcMain.handle('select-download-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择下载保存位置'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    const success = saveUserDownloadPath(selectedPath);
    return { path: selectedPath, success };
  }
  
  return { path: getDefaultDownloadPath(), success: false };
});

ipcMain.handle('get-audio-url', async (event, videoId) => {
  try {
    const audioUrl = await utils.getAudioUrl(videoId);
    return audioUrl;
  } catch (error) {
    console.error('Error in get-audio-url handler:', error);
    return '';
  }
});