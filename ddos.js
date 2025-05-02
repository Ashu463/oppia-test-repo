/**
 * PDF to SVG Processing Load Test Script
 * 
 * This script tests a web application that processes PDFs and SVG templates
 * by simulating concurrent requests with file uploads.
 * Specifically designed for testing applications that use Gemini API for data extraction.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { performance } = require('perf_hooks');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const cluster = require('cluster');
const os = require('os');

// Configuration options
const config = {
  endpoint: 'http://localhost:3000/process-pdf-svg', // Your application endpoint
  pdfPath: './sample.pdf', // Path to sample PDF file
  svgPath: './template.svg', // Path to sample SVG template
  totalRequests: 100, // Total number of requests to make
  concurrentRequests: 10, // How many simultaneous requests
  requestDelay: 50, // Delay between batches of requests (in ms)
  timeoutMs: 60000, // Request timeout in milliseconds
  useWorkers: true, // Use worker threads for better performance
  numWorkers: Math.max(os.cpus().length - 1, 1), // Use one less than available CPU cores
};

// Results collection
const results = {
  successful: 0,
  failed: 0,
  timeouts: 0,
  totalTime: 0,
  minTime: Number.MAX_SAFE_INTEGER,
  maxTime: 0,
  responseTimes: [],
  errors: [],
  startTime: null,
};

/**
 * Make a single request with file uploads
 */
async function makeRequest(requestId) {
  const formData = new FormData();
  
  // Add PDF file
  try {
    formData.append('pdf', fs.createReadStream(config.pdfPath), {
      filename: path.basename(config.pdfPath),
      contentType: 'application/pdf',
    });
  
    // Add SVG template
    formData.append('svg', fs.createReadStream(config.svgPath), {
      filename: path.basename(config.svgPath),
      contentType: 'image/svg+xml',
    });
  } catch (err) {
    console.error(`Error reading files: ${err.message}`);
    return { 
      success: false, 
      status: 'file_error', 
      time: 0, 
      error: `File error: ${err.message}` 
    };
  }

  const startTime = performance.now();
  
  try {
    const response = await axios.post(config.endpoint, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: config.timeoutMs,
    });
    
    const endTime = performance.now();
    const timeTaken = endTime - startTime;
    
    return {
      success: true,
      status: response.status,
      time: timeTaken,
    };
  } catch (error) {
    const endTime = performance.now();
    const timeTaken = endTime - startTime;
    
    const errorDetails = {
      success: false,
      time: timeTaken,
    };
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      errorDetails.status = error.response.status;
      errorDetails.error = `HTTP error: ${error.response.status}`;
    } else if (error.code === 'ECONNABORTED') {
      // The request timed out
      errorDetails.status = 'timeout';
      errorDetails.error = 'Request timeout';
    } else if (error.request) {
      // The request was made but no response was received
      errorDetails.status = 'no_response';
      errorDetails.error = 'No response received';
    } else {
      // Something happened in setting up the request
      errorDetails.status = 'request_error';
      errorDetails.error = `Request error: ${error.message}`;
    }
    
    return errorDetails;
  }
}

/**
 * Worker thread function
 */
function workerFunction() {
  parentPort.on('message', async (message) => {
    if (message.type === 'request') {
      const { startId, count } = message;
      const results = [];
      
      for (let i = 0; i < count; i++) {
        const requestId = startId + i;
        const result = await makeRequest(requestId);
        results.push({ requestId, ...result });
      }
      
      parentPort.postMessage({ type: 'results', results });
    }
  });
}

/**
 * Process and display final results
 */
function displayResults() {
  const totalDuration = performance.now() - results.startTime;
  const avgTime = results.responseTimes.length > 0 
    ? results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length 
    : 0;
  
  // Adjust min time if no successful requests
  if (results.minTime === Number.MAX_SAFE_INTEGER) {
    results.minTime = 0;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('LOAD TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Total Requests: ${config.totalRequests}`);
  console.log(`Successful Requests: ${results.successful}`);
  console.log(`Failed Requests: ${results.failed}`);
  console.log(`Timed Out Requests: ${results.timeouts}`);
  console.log(`Total Test Time: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`Requests Per Second: ${(config.totalRequests / (totalDuration / 1000)).toFixed(2)}`);
  console.log(`Requests Per Minute: ${(config.totalRequests / (totalDuration / 1000) * 60).toFixed(2)}`);
  console.log(`Average Response Time: ${avgTime.toFixed(2)}ms`);
  console.log(`Min Response Time: ${results.minTime.toFixed(2)}ms`);
  console.log(`Max Response Time: ${results.maxTime.toFixed(2)}ms`);
  
  if (results.errors.length > 0) {
    console.log('\nError Summary:');
    const errorCounts = {};
    results.errors.forEach(error => {
      errorCounts[error] = (errorCounts[error] || 0) + 1;
    });
    
    Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([error, count]) => {
        console.log(`- ${error}: ${count} occurrences`);
      });
  }
  console.log('='.repeat(60));
}

/**
 * Process a single result
 */
function processResult(result) {
  if (result.success) {
    results.successful++;
    results.responseTimes.push(result.time);
    results.minTime = Math.min(results.minTime, result.time);
    results.maxTime = Math.max(results.maxTime, result.time);
  } else {
    results.failed++;
    if (result.status === 'timeout') {
      results.timeouts++;
    }
    results.errors.push(result.error || 'Unknown error');
  }
  
  // Log progress
  const total = results.successful + results.failed;
  if (total % 10 === 0 || total === config.totalRequests) {
    const progress = (total / config.totalRequests * 100).toFixed(1);
    console.log(`Progress: ${progress}% (${total}/${config.totalRequests}) - Success: ${results.successful}, Failed: ${results.failed}`);
  }
}

/**
 * Main function to run the load test
 */
async function runLoadTest() {
  console.log('PDF to SVG Processing Load Test');
  console.log(`Target: ${config.endpoint}`);
  console.log(`Total Requests: ${config.totalRequests}`);
  console.log(`Concurrent Requests: ${config.concurrentRequests}`);
  
  // Check if files exist
  try {
    await fs.promises.access(config.pdfPath, fs.constants.R_OK);
    await fs.promises.access(config.svgPath, fs.constants.R_OK);
  } catch (err) {
    console.error(`Error: Cannot access test files.`);
    console.error(`Please ensure both files exist and are readable:`);
    console.error(`- PDF: ${config.pdfPath}`);
    console.error(`- SVG: ${config.svgPath}`);
    return;
  }
  
  results.startTime = performance.now();
  
  if (config.useWorkers) {
    // Worker threads implementation
    const workers = [];
    const requestsPerWorker = Math.ceil(config.totalRequests / config.numWorkers);
    
    console.log(`Using ${config.numWorkers} worker threads with ${requestsPerWorker} requests per worker`);
    
    // Create workers
    for (let i = 0; i < config.numWorkers; i++) {
      const worker = new Worker(__filename, {
        workerData: { isWorker: true }
      });
      
      worker.on('message', message => {
        if (message.type === 'results') {
          message.results.forEach(result => {
            processResult(result);
          });
        }
      });
      
      worker.on('error', error => {
        console.error(`Worker error: ${error}`);
      });
      
      worker.on('exit', code => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`);
        }
      });
      
      workers.push(worker);
    }
    
    // Distribute requests among workers
    let startId = 0;
    for (let i = 0; i < config.numWorkers; i++) {
      const count = Math.min(requestsPerWorker, config.totalRequests - startId);
      if (count <= 0) break;
      
      workers[i].postMessage({
        type: 'request',
        startId,
        count
      });
      
      startId += count;
    }
    
    // Wait for all workers to complete
    await new Promise(resolve => {
      let completedWorkers = 0;
      workers.forEach(worker => {
        worker.on('exit', () => {
          completedWorkers++;
          if (completedWorkers === workers.length) {
            resolve();
          }
        });
      });
    });
    
  } else {
    // Single-threaded implementation
    for (let batch = 0; batch < Math.ceil(config.totalRequests / config.concurrentRequests); batch++) {
      const batchPromises = [];
      
      for (let i = 0; i < config.concurrentRequests; i++) {
        const requestId = batch * config.concurrentRequests + i;
        if (requestId >= config.totalRequests) break;
        
        batchPromises.push(makeRequest(requestId).then(result => {
          processResult(result);
          return result;
        }));
      }
      
      await Promise.all(batchPromises);
      
      // Add delay between batches if specified
      if (config.requestDelay > 0 && batch < Math.ceil(config.totalRequests / config.concurrentRequests) - 1) {
        await new Promise(resolve => setTimeout(resolve, config.requestDelay));
      }
    }
  }
  
  displayResults();
}

// Start the worker or main thread
if (!isMainThread && workerData && workerData.isWorker) {
  workerFunction();
} else {
  // Main script execution
  console.log('Starting load test...');
  runLoadTest().catch(err => {
    console.error('Load test failed:', err);
  });
}