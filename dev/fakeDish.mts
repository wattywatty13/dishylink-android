// A stand-in Starlink dish and router for working on the layout without the
// hardware. Answers the same grpc-web Handle calls the app makes, encoded with the
// real dish.protoset, with plausible readings that move over time.
//
//   npx tsx dev/fakeDish.mts          # dish on :9201, router on :9001 (localhost)
//
// The Android dev build talks to it when localStorage.fakeDish = "1"
// (mobile/nativeFetch.ts rewrites the LAN addresses to localhost in a browser).
// Development only: nothing here ships in the app.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const registry = createFileRegistry(
  fromBinary(
    FileDescriptorSetSchema,
    readFileSync(new URL("../public/dish.protoset", import.meta.url)),
  ),
);
const responseSchema = registry.getMessage("SpaceX.API.Device.Response")!;

const startedAt = Date.now();
const HISTORY = 900;
const nowS = () => (Date.now() - startedAt) / 1000;

function wave(t: number, base: number, amp: number, period: number, noise = 0): number {
  return base + amp * Math.sin((2 * Math.PI * t) / period) + noise * (Math.random() - 0.5);
}

function series(fn: (t: number) => number): number[] {
  // A ring buffer indexed by `current % HISTORY`, as the dish keeps it.
  const current = Math.floor(nowS()) + 5000;
  const out = new Array<number>(HISTORY);
  for (let i = 0; i < HISTORY; i++) {
    const age = (current - i + HISTORY * 10) % HISTORY;
    out[(current - age) % HISTORY] = fn(nowS() - age);
  }
  return out;
}

function dishStatus() {
  const t = nowS();
  return {
    deviceInfo: {
      id: "ut01000000-00000000-00fake01",
      hardwareVersion: "rev4_prod2",
      softwareVersion: "2026.10.30.mr12345",
      countryCode: "CA",
      bootcount: 42,
    },
    deviceState: { uptimeS: String(Math.floor(86_400 * 3 + t)) },
    obstructionStats: { fractionObstructed: 0.0042, validS: 172_000, patchesValid: 2900 },
    alerts: {},
    downlinkThroughputBps: Math.max(0, wave(t, 38e6, 30e6, 47, 8e6)),
    uplinkThroughputBps: Math.max(0, wave(t, 4e6, 3e6, 31, 1e6)),
    popPingLatencyMs: wave(t, 31, 8, 23, 4),
    popPingDropRate: 0,
    boresightAzimuthDeg: 12.4,
    boresightElevationDeg: 64.8,
    gpsStats: { gpsValid: true, gpsSats: 14, pntFilterConvergenceState: "FILTER_CONVERGED" },
    ethSpeedMbps: 1000,
    softwareUpdateState: "IDLE",
    alignmentStats: {
      tiltAngleDeg: 25.1,
      boresightAzimuthDeg: 12.4,
      boresightElevationDeg: 64.8,
      desiredBoresightAzimuthDeg: 9.0,
      desiredBoresightElevationDeg: 65.0,
      attitudeEstimationState: "FILTER_CONVERGED",
      attitudeUncertaintyDeg: 0.6,
      hasActuators: "HAS_ACTUATORS_NO",
    },
    isSnrAboveNoiseFloor: true,
    readyStates: { scp: true, l1l2: true, xphy: true, aap: true, rf: true },
    secondsUntilSwupdateRebootPossible: -1,
    hasActuators: "HAS_ACTUATORS_NO",
  };
}

function dishHistory() {
  const startNs = BigInt(Date.now() - 6 * 60_000) * 1_000_000n;
  return {
    current: String(Math.floor(nowS()) + 5000),
    popPingDropRate: series((t) => (Math.floor(t) % 300 < 4 ? 1 : 0)),
    popPingLatencyMs: series((t) => wave(t, 31, 8, 23, 4)),
    downlinkThroughputBps: series((t) => Math.max(0, wave(t, 38e6, 30e6, 47, 8e6))),
    uplinkThroughputBps: series((t) => Math.max(0, wave(t, 4e6, 3e6, 31, 1e6))),
    powerIn: series((t) => wave(t, 46, 6, 90, 3)),
    outages: [
      {
        cause: "OBSTRUCTED",
        startTimestampNs: String(startNs),
        durationNs: "4000000000",
        didSwitch: true,
      },
    ],
    eventLog: {
      events: [
        {
          severity: "EVENT_SEVERITY_WARNING",
          reason: "EVENT_REASON_DOWNLINK_NETWORK_INTERRUPTION",
          startTimestampNs: String(startNs),
          durationNs: "2000000000",
        },
      ],
    },
  };
}

function obstructionMap() {
  const n = 123;
  const snr: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dx = c - n / 2;
      const dy = r - n / 2;
      const d = Math.hypot(dx, dy);
      if (d > n / 2) snr.push(-1);
      else if (d < 18 || (r + c) % 7 === 0) snr.push(-1);
      else if (dx > 35 && dy < -10 && dy > -30) snr.push(0);
      else snr.push(1);
    }
  }
  return { numRows: n, numCols: n, snr, maxThetaDeg: 80, mapReferenceFrame: "FRAME_EARTH" };
}

const CLIENTS = [
  ["Pixel-8", "aa:bb:cc:00:00:01", "192.168.1.21", 1],
  ["MacBook-Pro", "aa:bb:cc:00:00:02", "192.168.1.22", 2],
  ["Living-Room-TV", "aa:bb:cc:00:00:03", "192.168.1.23", 3],
  ["Xbox", "aa:bb:cc:00:00:04", "192.168.1.24", 4],
  ["iPad", "aa:bb:cc:00:00:05", "192.168.1.25", 5],
] as const;

function wifiClients() {
  const t = nowS();
  return {
    clients: CLIENTS.map(([name, mac, ip, id], i) => ({
      name,
      macAddress: mac,
      ipAddress: ip,
      signalStrength: -45 - i * 6,
      snr: 40 - i * 4,
      iface: i % 2 ? "RF_2GHZ" : "RF_5GHZ",
      clientId: id,
      associatedTimeS: 3600 * (i + 1),
      dhcpLeaseActive: true,
      rxStatsValid: true,
      txStatsValid: true,
      rxStats: {
        bytes: String(Math.floor((i + 1) * 1e9 + t * 2e5 * (i + 1))),
        throughputMbpsLast15sAvg: wave(t, 2 + i, 1.5, 20 + i),
      },
      txStats: {
        bytes: String(Math.floor((i + 1) * 4e9 + t * 9e5 * (5 - i))),
        throughputMbpsLast15sAvg: wave(t, 8 - i, 4, 17 + i),
      },
    })),
  };
}

function wifiConfig() {
  return {
    wifiConfig: {
      countryCode: "CA",
      networks: [
        {
          ipv4: "192.168.1.1/24",
          domain: "lan",
          basicServiceSets: [
            { bssid: "aa:bb:cc:dd:ee:01", ssid: "STARLINK", band: "RF_5GHZ" },
            { bssid: "aa:bb:cc:dd:ee:02", ssid: "STARLINK", band: "RF_2GHZ" },
          ],
        },
      ],
    },
  };
}

function routerStatus() {
  return {
    deviceInfo: {
      id: "Router-0100000000000000fake01",
      hardwareVersion: "v4",
      softwareVersion: "2026.10.1",
    },
    deviceState: { uptimeS: String(Math.floor(86_400 * 5 + nowS())) },
    alerts: {},
    popPingLatencyMs: wave(nowS(), 33, 8, 23, 4),
    popPingDropRate5m: 0.004,
  };
}

/** Response JSON for one request, by the Request oneof's field number. */
function answer(target: "dish" | "router", field: number): Record<string, unknown> | null {
  switch (field) {
    case 1004:
      return target === "dish"
        ? { dishGetStatus: dishStatus() }
        : { wifiGetStatus: routerStatus() };
    case 1007:
      return target === "dish"
        ? { dishGetHistory: dishHistory() }
        : { wifiGetHistory: { eventLog: { events: [] } } };
    case 1008:
      return { getDeviceInfo: { deviceInfo: dishStatus().deviceInfo } };
    case 1017:
      return { getLocation: { lla: { lat: 49.28, lon: -123.12, alt: 70 }, source: "GNC_FUSED" } };
    case 2008:
      return { dishGetObstructionMap: obstructionMap() };
    case 2011:
      return {
        dishGetConfig: {
          dishConfig: { snowMeltMode: "AUTO", locationRequestMode: "LOCAL", swupdateRebootHour: 3 },
        },
      };
    case 3002:
      return { wifiGetClients: wifiClients() };
    case 3009:
      return { wifiGetConfig: wifiConfig() };
    case 6000:
      return {
        dishGetDiagnostics: {
          id: dishStatus().deviceInfo.id,
          hardwareVersion: "rev4_prod2",
          softwareVersion: "2026.10.30",
          hardwareSelfTest: "PASSED",
          alignmentStats: dishStatus().alignmentStats,
        },
      };
    case 1036:
      return { getRadioStats: {} };
    default:
      return null; // reboot, stow, config writes, get_ping (never called) ...
  }
}

function readVarint(bytes: Uint8Array): number {
  let value = 0;
  let shift = 0;
  for (const byte of bytes) {
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return value;
}

function frame(flag: number, payload: Uint8Array): Buffer {
  const out = Buffer.alloc(5 + payload.length);
  out[0] = flag;
  out.writeUInt32BE(payload.length, 1);
  Buffer.from(payload).copy(out, 5);
  return out;
}

function serve(target: "dish" | "router", port: number): void {
  createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-grpc-web, x-user-agent");
    res.setHeader("Access-Control-Expose-Headers", "grpc-status, grpc-message");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const message = body.subarray(5);
      const field = readVarint(message) >>> 3;
      const json = answer(target, field);
      res.setHeader("Content-Type", "application/grpc-web+proto");
      if (json === null) {
        res.setHeader("grpc-status", "7");
        res.setHeader("grpc-message", "PermissionDenied");
        return void res.writeHead(200).end();
      }
      const bytes = toBinary(
        responseSchema,
        fromJson(responseSchema, json as never, { registry, ignoreUnknownFields: true }),
      );
      res.writeHead(200);
      res.end(
        Buffer.concat([
          frame(0x00, bytes),
          frame(0x80, Buffer.from("grpc-status: 0\r\ngrpc-message: \r\n")),
        ]),
      );
    });
  }).listen(port, "127.0.0.1", () => console.log(`fake ${target} on http://127.0.0.1:${port}`));
}

serve("dish", 9201);
serve("router", 9001);
