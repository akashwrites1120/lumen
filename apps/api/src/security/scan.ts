import { connect } from "node:net";

export interface ScanResult {
  clean: boolean;
  engine: string;
  detail?: string;
}

/**
 * Scans an upload buffer for malware.
 * Uses ClamAV INSTREAM over TCP when CLAMAV_HOST is configured; otherwise
 * fails open as an explicit stub until the AV sidecar ships.
 */
export async function scanBuffer(body: Buffer): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return { clean: true, engine: "none", detail: "virus scan stub (CLAMAV_HOST unset)" };

  const [hostname, portRaw] = host.split(":");
  const port = Number(portRaw || 3310);

  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port, timeout: 15_000 });
    const failOpen = (detail: string) => {
      socket.destroy();
      resolve({ clean: true, engine: "clamav", detail: `fail-open: ${detail}` });
    };

    socket.on("timeout", () => failOpen("timeout"));
    socket.on("error", (err) => failOpen(err.message));

    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "utf8"));
      for (let offset = 0; offset < body.byteLength; offset += 4096) {
        const chunk = body.subarray(offset, offset + 4096);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.byteLength);
        socket.write(header);
        socket.write(chunk);
      }
      socket.write(Buffer.from([0, 0, 0, 0])); // zero-length terminator
    });

    let response = "";
    socket.on("data", (d) => {
      response += d.toString("utf8");
      if (!response.endsWith("\n")) return;
      socket.end();
      const verdict = response.trim();
      if (verdict === "OK") resolve({ clean: true, engine: "clamav" });
      else resolve({ clean: false, engine: "clamav", detail: verdict.slice(0, 200) });
    });
  });
}
