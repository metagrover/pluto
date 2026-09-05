import ffprobe from '@ffprobe-installer/ffprobe';
import ffmpeg from 'ffmpeg-static';
import { verifyMediaExecutable } from './verify_media_executable.mjs';

if (!ffmpeg) throw new Error('FFmpeg is unavailable for this platform.');
await verifyMediaExecutable(ffmpeg, 'ffmpeg');
await verifyMediaExecutable(ffprobe.path, 'ffprobe');
console.log('Verified native portable FFmpeg and ffprobe.');
