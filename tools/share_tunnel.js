/**
 * Core Striker - High-Performance Instant Public Playtest Tunnel
 * Uses Cloudflare Quick Tunnels for sub-40ms latency, zero sign-up, zero password pages,
 * and reliable WebSockets. Falls back to localtunnel if needed.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

console.log("========================================================");
console.log("   CORE STRIKER // HIGH-SPEED PLAYTEST SHARE TUNNEL     ");
console.log("   Powered by Cloudflare Global Edge Network            ");
console.log("========================================================");
console.log("1. Checking local server on port 3000...");

// Check if local server is responsive
const req = http.get('http://localhost:3000', (res) => {
  console.log("   ✔ Local game server is online!");
  startCloudflareTunnel();
});

req.on('error', () => {
  console.log("   ⚠ Local server is not running on port 3000.");
  console.log("   Starting local game server now...");
  const srv = spawn('node', ['server.js'], { stdio: 'inherit' });
  setTimeout(startCloudflareTunnel, 1500);
});

function getCloudflaredBin() {
  try {
    const cf = require('cloudflared');
    if (cf && cf.bin && fs.existsSync(cf.bin)) {
      return cf.bin;
    }
  } catch (e) {}
  return null;
}

function startCloudflareTunnel() {
  console.log("2. Launching Cloudflare Edge Tunnel (Ultra-low latency, zero config)...");

  const cfBin = getCloudflaredBin();
  let proc;

  if (cfBin) {
    proc = spawn(cfBin, ['tunnel', '--url', 'http://localhost:3000']);
  } else {
    proc = spawn('npx', ['--yes', 'cloudflared', 'tunnel', '--url', 'http://localhost:3000'], { shell: true });
  }

  let foundUrl = false;
  const timeout = setTimeout(() => {
    if (!foundUrl) {
      console.log("\n⚠ Cloudflare tunnel timed out. Falling back to localtunnel...");
      try { proc.kill(); } catch (e) {}
      startLocalTunnelFallback();
    }
  }, 12000);

  function checkOutput(data) {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !foundUrl) {
      foundUrl = true;
      clearTimeout(timeout);
      const publicUrl = match[0].trim();
      printSuccessBanner(publicUrl, "Cloudflare Edge (Ultra-Fast 60fps)");
    }
  }

  proc.stdout.on('data', checkOutput);
  proc.stderr.on('data', checkOutput);

  proc.on('error', (err) => {
    if (!foundUrl) {
      clearTimeout(timeout);
      console.log(`Cloudflare launch error: ${err.message}. Falling back...`);
      startLocalTunnelFallback();
    }
  });

  proc.on('close', (code) => {
    if (!foundUrl) {
      clearTimeout(timeout);
      startLocalTunnelFallback();
    } else {
      console.log(`\nTunnel closed with code ${code}.`);
    }
  });
}

function startLocalTunnelFallback() {
  console.log("Opening fallback tunnel via localtunnel...");
  const lt = spawn('npx', ['--yes', 'localtunnel', '--port', '3000'], { shell: true });

  lt.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[^\s]+/);
    if (match) {
      const publicUrl = match[0].trim();
      printSuccessBanner(publicUrl, "Localtunnel Fallback");
    } else {
      process.stdout.write(text);
    }
  });

  lt.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
}

function printSuccessBanner(publicUrl, providerName) {
  console.log("\n========================================================");
  console.log("   🚀 PUBLIC PLAYTEST LINK READY TO SEND TO FRIENDS!   ");
  console.log(`   Provider: ${providerName}`);
  console.log("========================================================");
  console.log(`\n👉 SHARE THIS LINK WITH FRIENDS:`);
  console.log(`   ${publicUrl}`);
  console.log(`\n📊 LIVE FEEDBACK HUB (View reviews & ratings):`);
  console.log(`   ${publicUrl}/feedback`);
  console.log(`   (Or locally: http://localhost:3000/feedback)`);
  console.log("\n💡 HOW YOUR FRIENDS PLAY:");
  console.log("   1. Send them the link above.");
  console.log("   2. They open it in Safari, Chrome, Edge, or mobile browser.");
  console.log("   3. They pick a name, tap 'Enter Tournament' or join your Room Code.");
  console.log("   4. Low-latency edge WebSockets will synchronize turns and physics!\n");
  console.log("Keep this terminal window open while your friends are playing.");
  console.log("Press Ctrl + C when you want to stop sharing.\n");
}
