#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";

function checkPort(host, port, timeout = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const onDone = (ok) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => onDone(true));
    socket.once("timeout", () => onDone(false));
    socket.once("error", () => onDone(false));
    socket.connect(port, host);
  });
}

async function run() {
  const envFrontend = {
    ...process.env,
    BACKEND_URL: "http://localhost:3001",
  };

  console.log(
    `🚀 Starting Express backend and Vite (proxy → ${envFrontend.BACKEND_URL})`,
  );

  const backend = spawn("pnpm", ["run", "dev:backend:express"], {
    stdio: "inherit",
    env: process.env,
  });
  const frontend = spawn("pnpm", ["run", "dev:frontend"], {
    stdio: "inherit",
    env: envFrontend,
  });

  const onExit = (code) => process.exit(code ?? 0);
  backend.on("exit", onExit);
  frontend.on("exit", onExit);
}

run();
