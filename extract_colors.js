const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const videoPath = path.resolve('./reference.mp4');

// Args to extract raw RGB video from one frame at 5seconds
const args = [
    '-i', videoPath,
    '-ss', '00:00:02.500',
    '-vframes', '1',
    '-f', 'image2pipe', // output to pipe
    '-vcodec', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-'
];

const ffmpeg = spawn(ffmpegPath, args);

let buffer = Buffer.alloc(0);

ffmpeg.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
});

ffmpeg.stderr.on('data', (data) => {
    // console.error(`stderr: ${data}`);
});

ffmpeg.on('close', (code) => {
    if (code !== 0) {
        console.error(`ffmpeg process exited with code ${code}`);
        return;
    }
    
    processBuffer(buffer);
});

function processBuffer(buf) {
    const colorCounts = {};
    const totalPixels = buf.length / 3;
    
    for (let i = 0; i < buf.length; i += 3) {
        const r = buf[i];
        const g = buf[i+1];
        const b = buf[i+2];
        
        // Skip dark/light colors to find vibrant ones
        // Light: R,G,B > 240
        // Dark: R,G,B < 30
        if (r > 240 && g > 240 && b > 240) continue;
        if (r < 30 && g < 30 && b < 30) continue;
        
        // Quantize colors slightly to group similar shades (round to nearest 10)
        const round = (n) => Math.round(n / 10) * 10;
        const key = `${round(r)},${round(g)},${round(b)}`;
        
        colorCounts[key] = (colorCounts[key] || 0) + 1;
    }
    
    // Sort by frequency
    const sorted = Object.entries(colorCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20); // Top 20
        
    console.log("Top colors found (RGB):");
    sorted.forEach(([key, count]) => {
        const [r,g,b] = key.split(',').map(Number);
        const hex = "#" + [r,g,b].map(x => x.toString(16).padStart(2, '0')).join('');
        console.log(`${hex} (Count: ${count})`);
    });
}
