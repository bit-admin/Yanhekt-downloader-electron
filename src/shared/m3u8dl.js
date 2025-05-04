const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const utils = require('./utils');
const electron = require('electron');
const app = electron.app || (electron.remote ? electron.remote.app : null);

class M3u8Downloader {
  /**
   * @param {string} url - The m3u8 URL to download
   * @param {string} workDir - The working directory to save files in
   * @param {string} name - The name of the video file
   * @param {number} maxWorkers - Maximum number of concurrent downloads
   * @param {number} numRetries - Number of retries for failed downloads
   * @param {function} progressCallback - Callback to report progress
   * @param {string} basePath - Base path for downloads (optional)
   */
  constructor(url, workDir, name, maxWorkers = 32, numRetries = 99, progressCallback = null, basePath = null) {
    this._url = url;
    this._token = null;
    this._workDir = workDir;
    this._name = name;
    this._maxWorkers = maxWorkers;
    this._numRetries = numRetries;
    this._progressCallback = progressCallback || function() {};
    
    // 使用提供的基础路径或默认路径
    const defaultPath = app ? app.getPath('userData') : process.cwd();
    this._basePath = basePath || defaultPath;
    
    // 修复：检查workDir是否是绝对路径，避免重复拼接
    if (path.isAbsolute(this._workDir)) {
      // 如果workDir已经是绝对路径，则直接使用
      this._filePath = path.join(this._workDir, this._name);
    } else {
      // 如果workDir是相对路径，则拼接基础路径和工作目录
      this._filePath = path.join(this._basePath, this._workDir, this._name);
    }
    
    console.log("设置文件路径:", this._filePath);
    console.log("基础下载路径:", this._basePath);
    console.log("工作目录:", this._workDir);
    
    this._headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Safari/537.36 Edg/93.0.961.52",
      "Origin": "https://www.yanhekt.cn",
      "referer": "https://www.yanhekt.cn/"
    };

    this._frontUrl = null;
    this._tsUrlList = [];
    this._successSum = 0;
    this._tsSum = 0;
    this._isRunning = false;
    this._shouldStop = false;

    this._signature = null;
    this._timestamp = null;

    // Check if the file already exists
    if (fs.existsSync(`${this._filePath}.mp4`)) {
      console.log(`File '${this._filePath}.mp4' already exists, skip download`);
      this._progressCallback(100, 100, 2);
      return;
    }
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(path.dirname(this._filePath))) {
      fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
    }
  }

  /**
   * Start the download process
   */
  async start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._shouldStop = false;
    
    // Encrypt the URL using the utility function
    this._url = utils.encryptURL(this._url);
    
    try {
      await this.getM3u8Info(this._url, this._numRetries);
      
      // Start the signature update loop
      this.startUpdateSignatureLoop();
      
      console.log(`Downloading: ${this._name}`);
      console.log(`Save path: ${this._filePath}`);
      
      // Create directory for TS files
      if (!fs.existsSync(this._filePath)) {
        fs.mkdirSync(this._filePath, { recursive: true });
      }
      
      // Download all TS files in parallel with concurrency limit
      await this.downloadAllTsFiles();
      
      if (this._successSum === this._tsSum && !this._shouldStop) {
        this._progressCallback(this._successSum, this._tsSum, 1);
        await this.outputMp4();
        await this.deleteFiles();
        console.log(`Download successfully --> ${this._name}`);
        this._progressCallback(this._successSum, this._tsSum, 2);
      }
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      this._isRunning = false;
    }
  }

  /**
   * Stop the download process
   */
  stop() {
    this._shouldStop = true;
  }

  /**
   * Update signature in a separate loop
   */
  startUpdateSignatureLoop() {
    this._signatureInterval = setInterval(() => {
      if (this._shouldStop || this._successSum === this._tsSum) {
        clearInterval(this._signatureInterval);
        return;
      }
      
      const sigData = utils.getSignature();
      this._timestamp = sigData.timestamp;
      this._signature = sigData.signature;
    }, 10000); // Update every 10 seconds
  }

  /**
   * Get m3u8 file information
   */
  async getM3u8Info(m3u8Url, numRetries) {
    try {
      if (!this._token) {
        this._token = await utils.getToken();
      }
      
      const sigData = utils.getSignature();
      this._timestamp = sigData.timestamp;
      this._signature = sigData.signature;
      
      const url = utils.addSignatureForUrl(
        m3u8Url, 
        this._token, 
        this._timestamp, 
        this._signature
      );
      
      const response = await axios.get(url, {
        timeout: 30000,
        validateStatus: null,
        headers: this._headers
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to get m3u8 info: ${response.status}`);
      }
      
      this._frontUrl = response.request.res.responseUrl.split(response.request.path)[0];
      
      const responseText = response.data;
      
      // Check if this is a master playlist
      if (responseText.includes("EXT-X-STREAM-INF")) {
        // Extract the variant stream URL and recursively call this method
        const lines = responseText.split('\n');
        for (const line of lines) {
          if (line.startsWith('#')) continue;
          
          let variantUrl;
          if (line.startsWith('http')) {
            variantUrl = line;
          } else if (line.startsWith('/')) {
            variantUrl = this._frontUrl + line;
          } else {
            variantUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1) + line;
          }
          
          await this.getM3u8Info(variantUrl, this._numRetries);
          break;
        }
      } else {
        // Process the media playlist
        await this.getTsUrls(responseText);
      }
    } catch (error) {
      console.error("Error getting M3U8 info:", error);
      if (numRetries > 0 && !this._shouldStop) {
        await this.getM3u8Info(m3u8Url, numRetries - 1);
      } else {
        throw error;
      }
    }
  }

  /**
   * Extract TS file URLs from m3u8 content
   */
  async getTsUrls(m3u8TextStr) {
    let newM3u8Str = "";
    let tsCount = 0;
    
    const lines = m3u8TextStr.split('\n');
    for (const line of lines) {
      if (line.includes('#')) {
        if (line.includes('EXT-X-KEY') && line.includes('URI=')) {
          if (fs.existsSync(path.join(this._filePath, 'key'))) {
            continue;
          }
          
          const key = await this.downloadKey(line, 5);
          if (key) {
            newM3u8Str += `${key}\n`;
            continue;
          }
        }
        
        newM3u8Str += `${line}\n`;
        
        if (line.includes('EXT-X-ENDLIST')) {
          break;
        }
      } else if (line.trim() !== '') {
        let tsUrl;
        if (line.startsWith('http')) {
          tsUrl = line;
        } else if (line.startsWith('/')) {
          tsUrl = this._frontUrl + line;
        } else {
          tsUrl = this._url.substring(0, this._url.lastIndexOf('/') + 1) + line;
        }
        
        this._tsUrlList.push(tsUrl);
        
        // 使用简单的相对路径，这样在合并时更方便
        newM3u8Str += `${tsCount}.ts\n`;
        
        tsCount++;
      }
    }
    
    this._tsSum = tsCount;
    
    console.log(`生成m3u8文件: ${this._filePath}.m3u8`);
    console.log(`总共包含 ${tsCount} 个TS文件片段`);
    
    // 保存m3u8文件
    fs.writeFileSync(`${this._filePath}.m3u8`, newM3u8Str);
    
    // 同时生成ffmpeg concat格式的文件列表
    let concatContent = '';
    for (let i = 0; i < tsCount; i++) {
      // 使用单引号包裹文件路径，处理空格和特殊字符
      concatContent += `file '${path.join(this._filePath, `${i}.ts`).replace(/'/g, "'\\''").replace(/\\/g, "/")}'\n`;
    }
    fs.writeFileSync(`${this._filePath}.concat`, concatContent);
  }

  /**
   * Download all TS files with limited concurrency
   */
  async downloadAllTsFiles() {
    const downloadPromises = [];
    let index = 0;
    
    const downloadNext = async () => {
      if (index >= this._tsUrlList.length || this._shouldStop) return;
      
      const currentIndex = index++;
      const tsUrl = this._tsUrlList[currentIndex];
      const outputPath = path.join(this._filePath, `${currentIndex}.ts`);
      
      try {
        await this.downloadTs(tsUrl, outputPath, this._numRetries);
      } catch (error) {
        console.error(`Failed to download TS file ${currentIndex}:`, error);
      }
      
      // If we haven't reached the end, download the next file
      await downloadNext();
    };
    
    // Start multiple download workers
    for (let i = 0; i < this._maxWorkers && i < this._tsUrlList.length; i++) {
      downloadPromises.push(downloadNext());
    }
    
    // Wait for all downloads to complete
    await Promise.all(downloadPromises);
  }

  /**
   * Download a single TS file
   */
  async downloadTs(tsUrlOriginal, outputPath, numRetries) {
    if (this._shouldStop) return;
    
    try {
      if (!this._token) {
        this._token = await utils.getToken();
      }
      
      const tsUrl = utils.addSignatureForUrl(
        tsUrlOriginal.split('\n')[0],
        this._token,
        this._timestamp,
        this._signature
      );
      
      // Check if file already exists (for resume functionality)
      if (fs.existsSync(outputPath)) {
        this._successSum++;
        this._progressCallback(this._successSum, this._tsSum, 0);
        return;
      }
      
      const response = await axios.get(tsUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: this._headers
      });
      
      if (response.status === 200) {
        fs.writeFileSync(outputPath, response.data);
        this._successSum++;
        
        process.stdout.write(
          `\r[${Array(Math.floor((100 * this._successSum) / this._tsSum / 4) + 1).join('*').padEnd(25)}](${this._successSum}/${this._tsSum})`
        );
        
        this._progressCallback(this._successSum, this._tsSum, 0);
      } else if (numRetries > 0 && !this._shouldStop) {
        await this.downloadTs(tsUrlOriginal, outputPath, numRetries - 1);
      }
    } catch (error) {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      
      if (numRetries > 0 && !this._shouldStop) {
        await this.downloadTs(tsUrlOriginal, outputPath, numRetries - 1);
      } else {
        throw error;
      }
    }
  }

  /**
   * Download encryption key file if needed
   */
  async downloadKey(keyLine, numRetries) {
    try {
      const match = keyLine.match(/URI=[\'|\"].*?[\'|\"]/);
      if (!match) return null;
      
      const midPart = match[0];
      const mayKeyUrl = midPart.substring(5, midPart.length - 1);
      
      let trueKeyUrl;
      if (mayKeyUrl.startsWith('http')) {
        trueKeyUrl = mayKeyUrl;
      } else if (mayKeyUrl.startsWith('/')) {
        trueKeyUrl = this._frontUrl + mayKeyUrl;
      } else {
        trueKeyUrl = this._url.substring(0, this._url.lastIndexOf('/') + 1) + mayKeyUrl;
      }
      
      const response = await axios.get(trueKeyUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: this._headers
      });
      
      const keyPath = path.join(this._filePath, 'key');
      fs.writeFileSync(keyPath, response.data);
      
      return `${keyLine.split(midPart)[0]}URI="./${this._name}/key"${keyLine.split(midPart)[1] || ''}`;
    } catch (error) {
      console.error("Error downloading key:", error);
      
      const keyPath = path.join(this._filePath, 'key');
      if (fs.existsSync(keyPath)) {
        fs.unlinkSync(keyPath);
      }
      
      console.log("加密视频,无法加载key,解密失败");
      
      if (numRetries > 0 && !this._shouldStop) {
        return await this.downloadKey(keyLine, numRetries - 1);
      }
      
      return null;
    }
  }

  /**
   * Use FFmpeg to convert m3u8 to MP4
   */
  async outputMp4() {
    return new Promise((resolve, reject) => {
      console.log("开始转换为MP4...");
      console.log("使用ffmpeg路径:", ffmpegPath);
      
      // 使用concat方式处理
      const concatFilePath = path.resolve(`${this._filePath}.concat`);
      const mp4FilePath = path.resolve(`${this._filePath}.mp4`);
      
      console.log("文件列表路径:", concatFilePath);
      console.log("输出MP4路径:", mp4FilePath);
      
      // 使用concat方式传入文件列表
      const ffmpegArgs = [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFilePath,
        '-c', 'copy',
        '-bsf:a', 'aac_adtstoasc',
        '-movflags', '+faststart',
        '-progress', 'pipe:1', // 添加进度报告到stdout
        mp4FilePath
      ];
      
      console.log("执行ffmpeg命令:", ffmpegPath, ffmpegArgs.join(' '));
      
      // 在Windows上，需要确保使用正确的引号处理路径
      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
        windowsVerbatimArguments: process.platform === 'win32'
      });
      
      // 收集输出以便调试
      let stdoutData = '';
      let stderrData = '';
      
      // 用于解析FFmpeg进度
      let duration = 0;
      let currentTime = 0;
      let progressPercent = 0;
      
      ffmpegProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdoutData += text;
        
        // 解析FFmpeg进度输出
        const lines = text.trim().split('\n');
        for (const line of lines) {
          if (line.startsWith('out_time_ms=')) {
            currentTime = parseInt(line.split('=')[1]) / 1000000; // 转换为秒
          } else if (line.startsWith('out_time=')) {
            // 格式为 HH:MM:SS.MS
            const timeStr = line.split('=')[1];
            const timeParts = timeStr.split(':');
            if (timeParts.length === 3) {
              const hours = parseInt(timeParts[0]);
              const minutes = parseInt(timeParts[1]);
              const seconds = parseFloat(timeParts[2]);
              currentTime = hours * 3600 + minutes * 60 + seconds;
            }
          } else if (line.startsWith('duration=')) {
            const durationStr = line.split('=')[1];
            const durationParts = durationStr.split(':');
            if (durationParts.length === 3) {
              const hours = parseInt(durationParts[0]);
              const minutes = parseInt(durationParts[1]);
              const seconds = parseFloat(durationParts[2]);
              duration = hours * 3600 + minutes * 60 + seconds;
            }
          } else if (line.startsWith('progress=')) {
            const progress = line.split('=')[1].trim();
            if (progress === 'end') {
              // 转换完成
              progressPercent = 100;
              this._progressCallback(100, 100, 1);
            }
          }
        }
        
        // 如果有足够的信息计算进度
        if (duration > 0 && currentTime > 0) {
          progressPercent = Math.min(Math.floor((currentTime / duration) * 100), 99);
          this._progressCallback(progressPercent, 100, 1);
        }
        
        console.log(`ffmpeg stdout: ${text}`);
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderrData += text;
        console.log(`ffmpeg stderr: ${text}`);
        
        // 从stderr解析总时长（如果stdout中没有）
        if (duration === 0) {
          const durationMatch = text.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (durationMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseFloat(durationMatch[3]);
            duration = hours * 3600 + minutes * 60 + seconds;
          }
        }
        
        // 从stderr解析当前进度（如果stdout中没有）
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          currentTime = hours * 3600 + minutes * 60 + seconds;
          
          if (duration > 0) {
            progressPercent = Math.min(Math.floor((currentTime / duration) * 100), 99);
            this._progressCallback(progressPercent, 100, 1);
          }
        }
      });
      
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log("MP4转换成功完成");
          // 确保最终进度为100%
          this._progressCallback(100, 100, 1);
          resolve();
        } else {
          console.error(`FFmpeg退出代码: ${code}`);
          console.error("标准输出:", stdoutData);
          console.error("错误输出:", stderrData);
          
          // 检查输出文件是否存在，尽管有错误
          if (fs.existsSync(mp4FilePath)) {
            console.log("尽管ffmpeg返回错误，但MP4文件已生成");
            // 确保最终进度为100%
            this._progressCallback(100, 100, 1);
            resolve();
          } else {
            // 尝试备用方案
            this.fallbackOutputMp4(resolve, reject, stderrData);
          }
        }
      });
      
      ffmpegProcess.on('error', (err) => {
        console.error("FFmpeg进程错误:", err);
        this.fallbackOutputMp4(resolve, reject, err.toString());
      });
    });
  }
  
  /**
   * 使用备用方案将TS转换为MP4
   */
  fallbackOutputMp4(resolve, reject, errorMessage) {
    console.log("使用备用方案进行转换...");
    
    const mp4FilePath = path.resolve(`${this._filePath}.mp4`);
    const m3u8FilePath = path.resolve(`${this._filePath}.m3u8`);
    
    const fallbackArgs = [
      '-allowed_extensions', 'ALL',
      '-i', m3u8FilePath,
      '-c', 'copy',
      '-progress', 'pipe:1', // 添加进度报告到stdout
      mp4FilePath
    ];
    
    console.log("执行备用ffmpeg命令:", ffmpegPath, fallbackArgs.join(' '));
    
    const ffmpegProcess = spawn(ffmpegPath, fallbackArgs, {
      windowsVerbatimArguments: process.platform === 'win32'
    });
    
    let fbStdoutData = '';
    let fbStderrData = '';
    
    // 用于解析FFmpeg进度
    let duration = 0;
    let currentTime = 0;
    let progressPercent = 0;
    
    ffmpegProcess.stdout.on('data', (data) => {
      const text = data.toString();
      fbStdoutData += text;
      
      // 解析FFmpeg进度输出
      const lines = text.trim().split('\n');
      for (const line of lines) {
        if (line.startsWith('out_time_ms=')) {
          currentTime = parseInt(line.split('=')[1]) / 1000000; // 转换为秒
        } else if (line.startsWith('out_time=')) {
          // 格式为 HH:MM:SS.MS
          const timeStr = line.split('=')[1];
          const timeParts = timeStr.split(':');
          if (timeParts.length === 3) {
            const hours = parseInt(timeParts[0]);
            const minutes = parseInt(timeParts[1]);
            const seconds = parseFloat(timeParts[2]);
            currentTime = hours * 3600 + minutes * 60 + seconds;
          }
        } else if (line.startsWith('duration=')) {
          const durationStr = line.split('=')[1];
          const durationParts = durationStr.split(':');
          if (durationParts.length === 3) {
            const hours = parseInt(durationParts[0]);
            const minutes = parseInt(durationParts[1]);
            const seconds = parseFloat(durationParts[2]);
            duration = hours * 3600 + minutes * 60 + seconds;
          }
        } else if (line.startsWith('progress=')) {
          const progress = line.split('=')[1].trim();
          if (progress === 'end') {
            // 转换完成
            progressPercent = 100;
            this._progressCallback(100, 100, 1);
          }
        }
      }
      
      // 如果有足够的信息计算进度
      if (duration > 0 && currentTime > 0) {
        progressPercent = Math.min(Math.floor((currentTime / duration) * 100), 99);
        this._progressCallback(progressPercent, 100, 1);
      }
      
      console.log(`备用ffmpeg stdout: ${text}`);
    });
    
    ffmpegProcess.stderr.on('data', (data) => {
      const text = data.toString();
      fbStderrData += text;
      console.log(`备用ffmpeg stderr: ${text}`);
      
      // 从stderr解析总时长（如果stdout中没有）
      if (duration === 0) {
        const durationMatch = text.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (durationMatch) {
          const hours = parseInt(durationMatch[1]);
          const minutes = parseInt(durationMatch[2]);
          const seconds = parseFloat(durationMatch[3]);
          duration = hours * 3600 + minutes * 60 + seconds;
        }
      }
      
      // 从stderr解析当前进度（如果stdout中没有）
      const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        currentTime = hours * 3600 + minutes * 60 + seconds;
        
        if (duration > 0) {
          progressPercent = Math.min(Math.floor((currentTime / duration) * 100), 99);
          this._progressCallback(progressPercent, 100, 1);
        }
      }
    });
    
    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log("备用MP4转换成功完成");
        // 确保最终进度为100%
        this._progressCallback(100, 100, 1);
        resolve();
      } else if (fs.existsSync(mp4FilePath)) {
        console.log("尽管备用ffmpeg返回错误，但MP4文件已生成");
        // 确保最终进度为100%
        this._progressCallback(100, 100, 1);
        resolve();
      } else {
        reject(new Error(`FFmpeg转换失败。原始错误: ${errorMessage}，备用方案错误: ${fbStderrData}`));
      }
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error("备用FFmpeg进程错误:", err);
      reject(new Error(`FFmpeg转换失败。原始错误: ${errorMessage}，备用方案错误: ${err.toString()}`));
    });
  }

  /**
   * Clean up temporary files after successful download
   */
  async deleteFiles() {
    try {
      // Delete all TS files
      const files = fs.readdirSync(this._filePath);
      for (const file of files) {
        fs.unlinkSync(path.join(this._filePath, file));
      }
      
      // Delete the directory
      fs.rmdirSync(this._filePath);
      
      // Delete the m3u8 and concat files
      fs.unlinkSync(`${this._filePath}.m3u8`);
      if (fs.existsSync(`${this._filePath}.concat`)) {
        fs.unlinkSync(`${this._filePath}.concat`);
      }
    } catch (error) {
      console.error("Error deleting temporary files:", error);
    }
  }
}

module.exports = {
  M3u8Downloader
};