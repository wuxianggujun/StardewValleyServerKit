const net = require("node:net");
const { spawn } = require("node:child_process");

const host = process.env.VNC_NATIVE_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.VNC_NATIVE_PORT ?? "5900", 10);
const containerName = process.env.VNC_NATIVE_CONTAINER ?? "sdv-server";
const socketPath = process.env.VNC_NATIVE_SOCKET ?? "/tmp/vnc.sock";

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid VNC_NATIVE_PORT: ${process.env.VNC_NATIVE_PORT ?? ""}`);
  process.exit(1);
}

function proxyConnection(client) {
  const remote = `${client.remoteAddress}:${client.remotePort}`;
  console.log(`VNC client connected: ${remote}`);

  const child = spawn("docker", ["exec", "-i", containerName, "nc", "-U", socketPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  client.on("error", (error) => {
    console.error(`VNC client error (${remote}): ${error.message}`);
    child.kill();
  });

  child.on("error", (error) => {
    console.error(`Failed to start docker exec proxy: ${error.message}`);
    client.destroy();
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error(text);
    }
  });

  client.pipe(child.stdin);
  child.stdout.pipe(client);

  const closeBoth = () => {
    client.destroy();
    child.kill();
  };

  client.on("close", () => {
    console.log(`VNC client disconnected: ${remote}`);
    child.kill();
  });
  child.on("close", () => client.destroy());
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`docker exec VNC bridge exited with code ${code}`);
    }
    client.destroy();
  });
  child.stdin.on("error", closeBoth);
  child.stdout.on("error", closeBoth);
}

const server = net.createServer(proxyConnection);

server.on("error", (error) => {
  console.error(`VNC proxy error: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`VNC proxy listening on ${host}:${port} -> ${containerName}:${socketPath}`);
});
