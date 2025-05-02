import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const apiKey = 'AIzaSyCYSohdlBCPVjgEEsrq9GBwgroCn7OGwNI';
const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
const pdfPath = '/Users/rajvanshmalhotra/Documents/med.pdf';

const svgContent = ``;

let totalCount = 0;
let stopFlag = false;

async function makeSingleApiCall(pdfBase64, label) {
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${label} — summarize the following:
1️⃣ Research paper PDF attached.
2️⃣ This SVG abstract:
${svgContent}`
          },
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBase64
            }
          }
        ]
      }
    ]
  };

  const tmpFile = path.join('/tmp', `payload-${label}-${Date.now()}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload));

  const cmd = `curl -s -X POST "${url}?key=${apiKey}" \
  -H "Content-Type: application/json" \
  --data @"${tmpFile}"`;

  try {
    const { stdout } = await execAsync(cmd);
    const response = JSON.parse(stdout);

    await fs.unlink(tmpFile); // cleanup

    if (response.error && response.error.code === 429) {
      console.log(`Rate limit hit after ${totalCount} total requests.`);
      stopFlag = true;
      return;
    }

    totalCount++;
    console.log(`✅ ${totalCount} success (${label})`);
  } catch (error) {
    console.error(`❌ Request failed (${label}): ${error.message}`);
    await fs.unlink(tmpFile);
  }
}

async function blastRequests(pdfBase64, concurrentCount) {
  while (!stopFlag) {
    const batch = [];
    for (let i = 0; i < concurrentCount; i++) {
      batch.push(makeSingleApiCall(pdfBase64, `BATCH-${i + 1}`));
    }
    await Promise.all(batch);
  }
}

async function main() {
  const pdfBase64 = await fs.readFile(pdfPath, { encoding: 'base64' });

  const concurrentRequests = 10; // ← adjust: number of parallel calls per batch
  console.log(`🚀 Starting stress test with ${concurrentRequests} parallel requests per batch...`);

  await blastRequests(pdfBase64, concurrentRequests);
}

main();