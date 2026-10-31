const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const downloads = {};
let defaultDestination = path.join(os.homedir(), 'Downloads');

// ── Recap jobs ─────────────────────────────────────────────────────────────────
const recapJobs = {};

function validateCommand(cmd) {
    return /^(N_m3u8DL-RE|N_m3u8DL_RE|\.\/N_m3u8DL-RE)\s/.test(cmd.trim());
}

function injectSaveDir(cmd, dir) {
    return cmd
        .replace(/--save-dir\s+"[^"]*"/, '')
        .replace(/--save-dir\s+'[^']*'/, '')
        .replace(/--save-dir\s+\S+/, '')
        .replace(/\s+-d\s+"[^"]*"/, '')
        .replace(/\s+-d\s+'[^']*'/, '')
        .replace(/\s+-d\s+\S+/, '')
        .trim() + ` --save-dir "${dir}"`;
}

function expandHome(p) {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

app.get('/api/destination', (req, res) => {
    res.json({ destination: defaultDestination });
});

app.post('/api/destination', (req, res) => {
    const { destination } = req.body;
    if (!destination) return res.status(400).json({ error: 'No path provided' });
    const dir = expandHome(destination);
    if (!fs.existsSync(dir)) return res.status(400).json({ error: 'Directory does not exist' });
    defaultDestination = dir;
    res.json({ destination: dir });
});

// Uses native Mac folder picker via osascript
app.get('/api/pick-directory', (req, res) => {
    exec(`osascript -e 'POSIX path of (choose folder with prompt "Choose Download Destination")'`, (err, stdout) => {
        if (err) return res.status(400).json({ error: 'Cancelled' });
        const dir = stdout.trim();
        defaultDestination = dir;
        res.json({ destination: dir });
    });
});

app.post('/api/download', (req, res) => {
    const { command, destination } = req.body;
    if (!command || !validateCommand(command)) {
        return res.status(400).json({ error: 'Command must start with N_m3u8DL-RE followed by a URL' });
    }

    const saveDir = destination ? expandHome(destination) : defaultDestination;
    if (!fs.existsSync(saveDir)) {
        return res.status(400).json({ error: `Destination does not exist: ${saveDir}` });
    }

    const finalCmd = injectSaveDir(command, saveDir);
    const id = crypto.randomUUID();

    downloads[id] = {
        id,
        command: finalCmd,
        status: 'running',
        output: [],
        startTime: Date.now(),
        saveDir,
    };

    const env = {
        ...process.env,
        PATH: [process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin'].join(':'),
    };

    const child = spawn('sh', ['-c', finalCmd], { env });
    downloads[id].pid = child.pid;

    child.stdout.on('data', (d) => downloads[id].output.push({ t: 'o', s: d.toString() }));
    child.stderr.on('data', (d) => downloads[id].output.push({ t: 'e', s: d.toString() }));
    child.on('close', (code) => {
        downloads[id].status = code === 0 ? 'done' : code === null ? 'cancelled' : 'failed';
        downloads[id].exitCode = code;
        downloads[id]._child = null;
    });

    downloads[id]._child = child;
    res.json({ id });
});

app.post('/api/download/:id/cancel', (req, res) => {
    const dl = downloads[req.params.id];
    if (!dl) return res.status(404).json({ error: 'Not found' });
    if (dl._child) { dl._child.kill('SIGTERM'); dl.status = 'cancelled'; }
    res.json({ ok: true });
});

app.get('/api/download/:id/stream', (req, res) => {
    const dl = downloads[req.params.id];
    if (!dl) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let sent = 0;

    const flush = () => {
        while (sent < dl.output.length) {
            res.write(`data: ${JSON.stringify(dl.output[sent++])}\n\n`);
        }
        if (dl.status !== 'running') {
            res.write(`event: done\ndata: ${JSON.stringify({ status: dl.status })}\n\n`);
            clearInterval(timer);
            res.end();
        }
    };

    const timer = setInterval(flush, 120);
    flush();
    req.on('close', () => clearInterval(timer));
});

app.get('/api/downloads', (req, res) => {
    res.json(
        Object.values(downloads)
            .sort((a, b) => b.startTime - a.startTime)
            .map(({ id, status, startTime, saveDir, command }) => ({
                id, status, startTime, saveDir,
                preview: command.length > 120 ? command.slice(0, 120) + '…' : command,
            }))
    );
});

app.post('/api/open-finder', (req, res) => {
    const { dir } = req.body;
    const target = dir ? expandHome(dir) : defaultDestination;
    exec(`open "${target}"`, (err) => {
        if (err) return res.status(400).json({ error: 'Could not open Finder' });
        res.json({ ok: true });
    });
});

app.delete('/api/downloads/completed', (req, res) => {
    Object.keys(downloads).forEach((id) => {
        if (downloads[id].status !== 'running') delete downloads[id];
    });
    res.json({ ok: true });
});

// ── Recap: helpers ────────────────────────────────────────────────────────────

function recapEnv() {
    return {
        ...process.env,
        PATH: [
            process.env.PATH,
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/opt/homebrew/sbin',
            path.join(os.homedir(), 'Library/Python/3.11/bin'),
            path.join(os.homedir(), 'Library/Python/3.12/bin'),
            path.join(os.homedir(), '.local/bin'),
            '/usr/bin',
        ].join(':'),
    };
}

function startRecapJob(cmd, args, opts) {
    const id = crypto.randomUUID();
    const job = { id, cmd, status: 'running', output: [], startTime: Date.now(), ...opts };
    recapJobs[id] = job;

    const child = spawn(cmd, args, { env: recapEnv() });
    job._child = child;

    child.stdout.on('data', (d) => job.output.push({ t: 'o', s: d.toString() }));
    child.stderr.on('data', (d) => job.output.push({ t: 'e', s: d.toString() }));
    child.on('close', (code) => {
        job.status = code === 0 ? 'done' : code === null ? 'cancelled' : 'failed';
        job.exitCode = code;
        job._child = null;
    });

    return id;
}

// ── Recap: subtitles (Whisper) ────────────────────────────────────────────────

app.post('/api/recap/subtitles', (req, res) => {
    const { filePath, model = 'base', language = 'auto', outputDir } = req.body;

    if (!filePath) return res.status(400).json({ error: 'filePath is required' });
    const expanded = filePath.startsWith('~') ? path.join(os.homedir(), filePath.slice(1)) : filePath;
    if (!fs.existsSync(expanded)) return res.status(400).json({ error: `File not found: ${expanded}` });

    const saveDir = outputDir
        ? (outputDir.startsWith('~') ? path.join(os.homedir(), outputDir.slice(1)) : outputDir)
        : path.dirname(expanded);

    const args = [expanded, '--model', model, '--output_format', 'srt', '--output_dir', saveDir];
    if (language && language !== 'auto') args.push('--language', language);

    const id = startRecapJob('whisper', args, {
        type: 'subtitles',
        filePath: expanded,
        outputDir: saveDir,
        model,
    });

    res.json({ id });
});

// ── Recap: voice (edge-tts) ───────────────────────────────────────────────────

function stripSrt(srt) {
    return srt
        .replace(/^\d+\s*$/gm, '')
        .replace(/^\d{2}:\d{2}:\d{2},\d{3} --> .+$/gm, '')
        .replace(/<[^>]+>/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ');
}

app.post('/api/recap/voice', (req, res) => {
    const { text, srtPath, voice = 'en-US-AriaNeural', outputPath } = req.body;

    let narrationText = text || '';

    if (!narrationText && srtPath) {
        const srt = srtPath.startsWith('~') ? path.join(os.homedir(), srtPath.slice(1)) : srtPath;
        if (!fs.existsSync(srt)) return res.status(400).json({ error: `SRT not found: ${srt}` });
        narrationText = stripSrt(fs.readFileSync(srt, 'utf8'));
    }

    if (!narrationText) return res.status(400).json({ error: 'Provide text or srtPath' });
    if (narrationText.length > 50000) narrationText = narrationText.slice(0, 50000);

    const out = outputPath
        ? (outputPath.startsWith('~') ? path.join(os.homedir(), outputPath.slice(1)) : outputPath)
        : path.join(os.homedir(), 'Downloads', `recap-voice-${Date.now()}.mp3`);

    const args = ['--voice', voice, '--text', narrationText, '--write-media', out];
    const id = startRecapJob('edge-tts', args, {
        type: 'voice',
        outputPath: out,
        voice,
    });

    res.json({ id, outputPath: out });
});

// ── Recap: list voices ────────────────────────────────────────────────────────

app.get('/api/recap/voices', (req, res) => {
    exec('edge-tts --list-voices', { env: recapEnv() }, (err, stdout) => {
        if (err) return res.status(500).json({ error: 'edge-tts not found. Run install.sh first.' });
        const lines = stdout.trim().split('\n').slice(1);
        const voices = lines.map(l => {
            const parts = l.trim().split(/\s+/);
            return { name: parts[0], locale: parts[1], gender: parts[2] };
        }).filter(v => v.name);
        res.json(voices);
    });
});

// ── Recap: job streaming (SSE) ────────────────────────────────────────────────

app.get('/api/recap/job/:id/stream', (req, res) => {
    const job = recapJobs[req.params.id];
    if (!job) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let sent = 0;
    const flush = () => {
        while (sent < job.output.length) {
            res.write(`data: ${JSON.stringify(job.output[sent++])}\n\n`);
        }
        if (job.status !== 'running') {
            res.write(`event: done\ndata: ${JSON.stringify({ status: job.status, outputPath: job.outputPath, outputDir: job.outputDir })}\n\n`);
            clearInterval(timer);
            res.end();
        }
    };

    const timer = setInterval(flush, 150);
    flush();
    req.on('close', () => clearInterval(timer));
});

app.get('/api/recap/jobs', (req, res) => {
    res.json(
        Object.values(recapJobs)
            .sort((a, b) => b.startTime - a.startTime)
            .map(({ id, type, status, startTime, outputPath, outputDir, filePath, model, voice }) => ({
                id, type, status, startTime, outputPath, outputDir, filePath, model, voice,
            }))
    );
});

app.post('/api/recap/job/:id/cancel', (req, res) => {
    const job = recapJobs[req.params.id];
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job._child) { job._child.kill('SIGTERM'); job.status = 'cancelled'; }
    res.json({ ok: true });
});

app.post('/api/open-file', (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'No path' });
    const p = filePath.startsWith('~') ? path.join(os.homedir(), filePath.slice(1)) : filePath;
    exec(`open "${p}"`, (err) => {
        if (err) return res.status(400).json({ error: 'Could not open file' });
        res.json({ ok: true });
    });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`✓  N_m3u8DL-RE Downloader → http://localhost:${PORT}`);
    exec(`open http://localhost:${PORT}`);
});
