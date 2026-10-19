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

// CH341A programmer: detect connection and flash chip
app.get('/api/ch341/detect', (req, res) => {
    const env = {
        ...process.env,
        PATH: [process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/bin', '/bin'].join(':'),
    };

    exec('flashrom -p ch341a_spi 2>&1', { env, timeout: 15000 }, (err, stdout) => {
        const output = (stdout || '').trim();

        // Check if flashrom is installed
        if (err && err.code === 127) {
            return res.json({ connected: false, chip: null, output, error: 'flashrom not installed. Install with: brew install flashrom' });
        }

        // Programmer not found / USB not connected
        if (output.includes('Could not connect') || output.includes('No device found') || output.includes('Cannot open USB device')) {
            return res.json({ connected: false, chip: null, output, error: 'CH341A programmer not detected. Check USB connection.' });
        }

        // Flash chip found
        const chipMatch = output.match(/Found .+ flash chip "([^"]+)"/i);
        if (chipMatch) {
            return res.json({ connected: true, chip: chipMatch[1], output });
        }

        // Programmer found but no flash chip
        if (output.includes('No EEPROM') || output.includes('No flash device')) {
            return res.json({ connected: true, chip: null, output, error: 'Programmer connected but no flash chip detected.' });
        }

        // Unknown output — return as-is
        return res.json({ connected: true, chip: null, output });
    });
});

app.listen(PORT, () => {
    console.log(`✓  N_m3u8DL-RE Downloader → http://localhost:${PORT}`);
    exec(`open http://localhost:${PORT}`);
});
