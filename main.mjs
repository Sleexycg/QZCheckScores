import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function loadLocalEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const BASE_URL = (process.env.JW_BASE_URL || "https://jw.sdau.edu.cn").replace(/\/+$/, "");
const STUDENT_ID = (process.env.JW_STUDENT_ID || "").trim();
const PASSWORD = (process.env.JW_PASSWORD || "").trim();
const PUSH_URL = (process.env.SHOWDOC_PUSH_URL || "").trim();
const WATCH_TERM = (process.env.WATCH_TERM || "").trim();
const HASH_A_PATH = process.env.GRADE_HASH_A_PATH || "Hash_New.txt";
const HASH_B_PATH = process.env.GRADE_HASH_B_PATH || "Hash_Origin.txt";
const DEBUG_LOGIN = String(process.env.DEBUG_LOGIN || "").trim() === "1";
const FORCE_PUSH = process.argv.includes("--force-push");

function assertRequired() {
  if (!STUDENT_ID || !PASSWORD) {
    throw new Error("Missing required env: JW_STUDENT_ID / JW_PASSWORD");
  }
}

function inferDefaultTerm() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const startYear = month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const endYear = startYear + 1;
  const termNo = month >= 2 && month <= 7 ? 2 : 1;
  return `${startYear}-${endYear}-${termNo}`;
}

function encodeInp(input) {
  return Buffer.from(input, "utf8").toString("base64");
}

function buildEncodedCredential(account, password, scodeSeed, sxh) {
  const accountEncoded = encodeInp(account);
  const passwordEncoded = encodeInp(password);
  const codeDogEncoded = encodeInp(" ");
  const code = `${accountEncoded}%%%${passwordEncoded}%%%${codeDogEncoded}`;

  let scode = scodeSeed;
  let encoded = "";
  for (let i = 0; i < code.length; i += 1) {
    if (i < 55) {
      const idx = Number.parseInt(sxh.slice(i, i + 1), 10);
      const safeIdx = Number.isFinite(idx) && idx > 0 ? idx : 0;
      encoded += `${code[i]}${scode.slice(0, safeIdx)}`;
      scode = scode.slice(safeIdx);
    } else {
      encoded += code.slice(i);
      break;
    }
  }
  return encoded;
}

function extractLoginSeed(html) {
  const scode = html.match(/var\s+scode\s*=\s*"([^"]+)";/)?.[1]?.trim();
  const sxh = html.match(/var\s+sxh\s*=\s*"([^"]+)";/)?.[1]?.trim();
  if (!scode || !sxh) throw new Error("Failed to extract login seed: scode/sxh");
  return { scode, sxh };
}

function isLoginPage(html) {
  return /name=["']loginForm["']|欢迎登录教务系统|请先登录系统/i.test(html);
}

function parseLoginMessage(html) {
  return html.match(/id=["']showMsg["'][^>]*>([^<]*)</i)?.[1]?.trim() || "";
}

function stripTags(text) {
  return String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseProfileFromHtml(html) {
  const profile = { name: "", studentId: "", className: "", college: "" };

  const titleRaw =
    html.match(/class=["'][^"']*\binfoContentTitle\b[^"']*["'][^>]*>([\s\S]*?)</i)?.[1] || "";
  const title = stripTags(titleRaw);
  const matched = title.match(/(.+)-(\d{6,})$/);
  if (matched) {
    profile.name = matched[1].trim();
    profile.studentId = matched[2].trim();
  }

  const detailRows =
    html.match(/<[^>]*class=["'][^"']*\bqz-detailtext\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi) || [];
  for (const row of detailRows) {
    const text = stripTags(row).replace(/\u00a0/g, " ").replace(/\s+/g, "");
    const parts = text.split(/[：:]/);
    if (parts.length < 2) continue;
    const label = parts[0];
    const value = parts.slice(1).join(":").trim();
    if (!value) continue;
    if (label.includes("班级")) profile.className = value;
    if (label.includes("学院")) profile.college = value;
  }

  return profile;
}

function parseProfileFromPlainText(html) {
  const text = stripTags(html).replace(/\u00a0/g, " ");
  const textNoSpace = text.replace(/\s+/g, "");
  const profile = { name: "", studentId: "", className: "", college: "" };

  const idMatch = text.match(/(\d{8,})/);
  if (idMatch) profile.studentId = idMatch[1];

  // Common title pattern: 姓名-学号
  const nameIdMatch = text.match(/([\u4e00-\u9fa5A-Za-z·]{2,20})\s*-\s*(\d{8,})/);
  if (nameIdMatch) {
    profile.name = nameIdMatch[1];
    profile.studentId = nameIdMatch[2];
  }

  // 支持“班 级：”“班级:”“行政班级：”等写法
  const classMatch =
    textNoSpace.match(/(?:班级|行政班级|教学班)[:：]?(.+?)(?=(?:学院|院系|专业|姓名|学号|$))/) ||
    text.match(/(?:班\s*级|行政班级|教学班)\s*[:：]\s*([^\r\n]{1,60})/);
  if (classMatch) profile.className = String(classMatch[1]).trim();

  // 支持“学院：”“院系：”等写法
  const collegeMatch =
    textNoSpace.match(/(?:学院|院系|所在学院)[:：]?(.+?)(?=(?:班级|行政班级|专业|姓名|学号|$))/) ||
    text.match(/(?:学\s*院|院系|所在学院)\s*[:：]\s*([^\r\n]{1,60})/);
  if (collegeMatch) profile.college = String(collegeMatch[1]).trim();

  // 去掉可能误吞的尾部标签字
  profile.className = profile.className.replace(/[：:]+$/, "");
  profile.college = profile.college.replace(/[：:]+$/, "");

  return profile;
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ["rows", "data", "list", "result"]) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

function normalizeRecord(row) {
  const read = (...keys) => {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  };
  return {
    courseCode: read("kch", "courseCode", "kcdm"),
    courseName: read("kc_mc", "kcmc", "courseName"),
    score: read("zcj", "zcjstr", "score"),
    credit: read("xf", "credit"),
    studentIdRaw: read("xs0101id"),
    teachingTaskId: read("jx0404id"),
    scoreRecordId: read("cj0708id"),
  };
}

function serializeScoresForHash(records) {
  return records
    .map((r) => `${r.courseCode}|${r.courseName}|${r.score}|${r.credit}`)
    .sort()
    .join("\n");
}

function md5(text) {
  return createHash("md5").update(text, "utf8").digest("hex");
}

function readHashFile(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").trim();
}

function writeHashFile(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function runABComparisonStep(currentHash) {
  // 1) 清空 B
  writeHashFile(HASH_B_PATH, "");
  // 2) 将 A 内容写入 B
  const hashAOld = readHashFile(HASH_A_PATH);
  writeHashFile(HASH_B_PATH, hashAOld);
  // 3) 清空 A
  writeHashFile(HASH_A_PATH, "");
  // 4/5) 将本次成绩 MD5 写入 A
  writeHashFile(HASH_A_PATH, currentHash);
  // 6) 比对 A 与 B
  const hashANow = readHashFile(HASH_A_PATH);
  const hashBNow = readHashFile(HASH_B_PATH);
  return hashANow === hashBNow;
}

function calculateCurrentGpa(records) {
  let creditPointSum = 0;
  let totalCredit = 0;

  for (const r of records) {
    const score = Number.parseFloat(String(r?.score ?? ""));
    if (!Number.isFinite(score)) continue;
    const point = Math.max(0, Math.min(5, (score - 50) / 10));

    const credit = Number.parseFloat(String(r?.credit ?? ""));
    if (Number.isFinite(credit) && credit > 0) {
      // 学分绩点 = 绩点 * 学分
      creditPointSum += point * credit;
      totalCredit += credit;
    }
  }

  // GPA = 所有课的学分绩点之和 / 所有课的学分之和
  if (totalCredit > 0) return (creditPointSum / totalCredit).toFixed(2);
  return "-";
}

function parseTotalGpaFromSummaryPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const raw = String(payload.pjxfjd ?? "").trim();
  return raw;
}

async function fetchTotalGpa(cookieHeader) {
  const query = new URLSearchParams({
    pageNum: "1",
    pageSize: "200",
    kksj: "",
    kcxz: "",
    kcsx: "",
    kcmc: "",
    xsfs: "all",
    sfxsbcxq: "1",
  });
  const response = await jwRequest(`/kscj/cjcx_list?${query.toString()}`, { cookieHeader });
  if (!response.ok || isLoginPage(response.text)) return "";
  try {
    const payload = JSON.parse(response.text.replace(/^\uFEFF/, "").trim());
    return parseTotalGpaFromSummaryPayload(payload);
  } catch {
    return "";
  }
}

function formatPushMessage(term, records, profile, totalGpa, mode = "update") {
  const termGpa = calculateCurrentGpa(records);
  const overallGpa = totalGpa || "-";
  const lines =
    mode === "init"
      ? [
          "你的程序运行成功",
          "从现在开始，程序每隔一段时间自动检测一次成绩，若有更新，将通过微信推送及时通知你",
          "",
          `学期：${term}`,
          "",
          "---",
          "",
          "**个人信息**",
          "",
          `姓名：${profile?.name || "-"}`,
          `学号：${profile?.studentId || "-"}`,
          `班级：${profile?.className || "-"}`,
          `学院：${profile?.college || "-"}`,
          `本学期GPA：${termGpa}`,
          `总GPA：${overallGpa}`,
          "",
          "---",
          "",
          "**成绩信息**",
          "",
        ]
      : [
          "教务系统成绩已更新",
          "",
          `学期：${term}`,
          "",
          "---",
          "",
          "**个人信息**",
          "",
          `姓名：${profile?.name || "-"}`,
          `学号：${profile?.studentId || "-"}`,
          `班级：${profile?.className || "-"}`,
          `学院：${profile?.college || "-"}`,
          `本学期GPA：${termGpa}`,
          `总GPA：${overallGpa}`,
          "",
          "---",
          "",
          "**成绩信息**",
          "",
        ];

  for (const r of records) {
    lines.push(`课程名称：${r.courseName || "-"}`);
    const extra =
      r?.usualScore || r?.finalScore
        ? `（平时：${r?.usualScore || "-"}，期末：${r?.finalScore || "-"}）`
        : "";
    lines.push(`成绩：${r.score || "-"}${extra}`);
    lines.push(`学分：${r.credit || "-"}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function sendPush(title, content) {
  if (!PUSH_URL) {
    console.log("SHOWDOC_PUSH_URL not configured, skip push.");
    return;
  }

  const attempts = [
    async () =>
      fetch(PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title, content }),
      }),
    async () =>
      fetch(PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      }),
  ];

  let lastError = "unknown push error";
  for (const call of attempts) {
    const response = await call();
    const responseText = await response.text();
    if (!response.ok) {
      lastError = `HTTP ${response.status} ${responseText}`;
      continue;
    }
    try {
      const payload = JSON.parse(responseText);
      if (payload?.error_code && Number(payload.error_code) !== 0) {
        lastError = payload?.error_message || responseText;
        continue;
      }
    } catch {
      // ignore non-json response
    }
    return;
  }
  throw new Error(`Push failed: ${lastError}`);
}

function mergeCookieHeader(previous, setCookieValues) {
  const jar = new Map();
  const loadCookieLine = (line) => {
    const first = (line || "").split(";")[0]?.trim();
    if (!first || !first.includes("=")) return;
    const eq = first.indexOf("=");
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) jar.set(name, value);
  };
  (previous || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach(loadCookieLine);
  for (const item of setCookieValues || []) loadCookieLine(item);
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function getSetCookieHeaders(res) {
  const maybeGetSetCookie = res.headers?.getSetCookie;
  if (typeof maybeGetSetCookie === "function") {
    return maybeGetSetCookie.call(res.headers);
  }
  const raw = res.headers.get("set-cookie");
  return raw ? raw.split(/, (?=[^;]+?=)/g) : [];
}

async function jwRequest(pathname, { method = "GET", body, cookieHeader = "", referer = "" } = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (referer) headers.Referer = referer;
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";

  const res = await fetch(`${BASE_URL}${pathname}`, { method, headers, body, redirect: "follow", cache: "no-store" });
  const text = await res.text();
  const setCookie = getSetCookieHeaders(res);
  return {
    ok: res.ok,
    status: res.status,
    text,
    cookieHeader: mergeCookieHeader(cookieHeader, setCookie),
    finalUrl: res.url || `${BASE_URL}${pathname}`,
  };
}

async function login() {
  const homepage = await jwRequest("/");
  const { scode, sxh } = extractLoginSeed(homepage.text);
  const encoded = buildEncodedCredential(STUDENT_ID, PASSWORD, scode, sxh);
  const body = new URLSearchParams({
    loginMethod: "LoginToXk",
    userlanguage: "0",
    userAccount: STUDENT_ID,
    userPassword: "",
    encoded,
  });
  const loginResult = await jwRequest("/xk/LoginToXk", {
    method: "POST",
    body,
    cookieHeader: homepage.cookieHeader,
    referer: homepage.finalUrl,
  });
  const loginMessage = parseLoginMessage(loginResult.text);
  if (DEBUG_LOGIN) {
    console.log(`[login] JW_STUDENT_ID.len=${STUDENT_ID.length}, JW_PASSWORD.len=${PASSWORD.length}, msg=${loginMessage || "(empty)"}`);
  }
  if (loginMessage && !/请先登录系统/i.test(loginMessage)) throw new Error(`Login failed: ${loginMessage}`);
  if (isLoginPage(loginResult.text)) throw new Error("Login failed: invalid credentials or blocked");
  return loginResult.cookieHeader;
}

async function fetchScores(cookieHeader, term) {
  const query = new URLSearchParams({
    pageNum: "1",
    pageSize: "200",
    kksj: term,
    kcxz: "",
    kcsx: "",
    kcmc: "",
    xsfs: "all",
    sfxsbcxq: "1",
  });
  const response = await jwRequest(`/kscj/cjcx_list?${query.toString()}`, { cookieHeader });
  if (!response.ok) throw new Error(`Score request failed: HTTP ${response.status}`);
  if (isLoginPage(response.text)) throw new Error("Session invalid when fetching scores");
  let payload;
  try {
    payload = JSON.parse(response.text.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new Error("Score API returned non-JSON");
  }
  return normalizeRows(payload).map(normalizeRecord).filter((r) => r.courseCode || r.courseName);
}

function parseUsualScoreDetailFromText(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  const matches = raw.match(/let\s+arr\s*=\s*(\[[\s\S]*?\]);?/i) ?? raw.match(/arr\s*=\s*(\[[\s\S]*?\]);?/i);
  if (!matches?.[1]) return { usualScore: "", finalScore: "" };
  const parsed = JSON.parse(matches[1]);
  const first = parsed?.[0] ?? {};
  // 对齐 WeSDAU 的字段映射
  return {
    usualScore: String(first.cjxm3 ?? "").trim(),
    finalScore: String(first.cjxm1 ?? "").trim(),
  };
}

async function fetchUsualScoreDetail(cookieHeader, record) {
  const xs0101id = record.studentIdRaw || STUDENT_ID;
  const jx0404id = record.teachingTaskId || "";
  const cj0708id = record.scoreRecordId || "";
  const zcj = record.score || "";
  if (!xs0101id || !jx0404id || !cj0708id) return { usualScore: "", finalScore: "" };

  const query = new URLSearchParams({ xs0101id, jx0404id, cj0708id, zcj });
  const response = await jwRequest(`/kscj/pscj_list.do?${query.toString()}`, { cookieHeader });
  if (!response.ok || isLoginPage(response.text)) return { usualScore: "", finalScore: "" };
  try {
    return parseUsualScoreDetailFromText(response.text);
  } catch {
    return { usualScore: "", finalScore: "" };
  }
}

async function enrichScoresWithUsualFinal(cookieHeader, records) {
  const tasks = records.map(async (r) => {
    const detail = await fetchUsualScoreDetail(cookieHeader, r);
    return { ...r, usualScore: detail.usualScore, finalScore: detail.finalScore };
  });
  return Promise.all(tasks);
}

async function fetchStudentProfile(cookieHeader) {
  const candidates = [
    "/framework/xsMainV_new.htmlx?t1=1",
    "/framework/xsMainV.htmlx",
    "/framework/xsMainV.jsp",
    "/jsxsd/framework/xsMainV.htmlx",
    "/jsxsd/framework/xsMainV.jsp",
  ];
  for (const endpoint of candidates) {
    const response = await jwRequest(endpoint, { cookieHeader });
    if (isLoginPage(response.text)) throw new Error("Session invalid when fetching profile");
    const fromHtml = parseProfileFromHtml(response.text);
    if (fromHtml.name || fromHtml.studentId || fromHtml.className || fromHtml.college) {
      if (DEBUG_LOGIN) console.log(`[profile] hit=${endpoint} htmlParser=ok`);
      return fromHtml;
    }
    const fromText = parseProfileFromPlainText(response.text);
    if (fromText.name || fromText.studentId || fromText.className || fromText.college) {
      if (DEBUG_LOGIN) console.log(`[profile] hit=${endpoint} textParser=ok`);
      return fromText;
    }
    if (DEBUG_LOGIN) {
      const preview = stripTags(response.text).slice(0, 120).replace(/\s+/g, " ");
      console.log(`[profile] miss=${endpoint} preview=${preview}`);
    }
  }
  return { name: "", studentId: "", className: "", college: "" };
}

async function main() {
  assertRequired();
  if (DEBUG_LOGIN) {
    console.log(`[env] studentId.len=${STUDENT_ID.length}, password.len=${PASSWORD.length}, base=${BASE_URL}`);
  }

  const term = WATCH_TERM || inferDefaultTerm();
  const cookie = await login();
  const profile = await fetchStudentProfile(cookie);
  const records = await fetchScores(cookie, term);
  const recordsWithDetail = await enrichScoresWithUsualFinal(cookie, records);
  const totalGpa = await fetchTotalGpa(cookie);
  const scoreHash = md5(serializeScoresForHash(records));

  const firstRun = !readHashFile(HASH_A_PATH) && !readHashFile(HASH_B_PATH);
  let isSame = runABComparisonStep(scoreHash);
  if (firstRun) {
    // 首次运行，按要求执行两遍
    isSame = runABComparisonStep(scoreHash);
    const title = "强智教务系统成绩推送";
    const content = formatPushMessage(term, recordsWithDetail, profile, totalGpa, "init");
    await sendPush(title, content);
    console.log("First run push sent.");
    return;
  }

  if (isSame) {
    if (FORCE_PUSH) {
      const title = "强智教务系统成绩推送";
      const content = formatPushMessage(term, recordsWithDetail, profile, totalGpa, "update");
      await sendPush(title, content);
      console.log("Force push sent (manual test).");
      return;
    }
    console.log("No new score update.");
    return;
  }

  const title = "强智教务系统成绩推送";
  const content = formatPushMessage(term, recordsWithDetail, profile, totalGpa, "update");
  await sendPush(title, content);
  console.log("Hash changed and push sent.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
