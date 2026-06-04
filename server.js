import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 3000;
const modelList = (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite,gemini-2.0-flash,gemini-2.5-flash")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const staticDir = path.join(__dirname, "outputs");

async function loadEnv() {
  try {
    const envText = await fs.readFile(path.join(__dirname, ".env"), "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Missing .env is handled when the API route is called.
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  }[ext] || "application/octet-stream";
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function buildPrompt({ profile = {}, message = "", history = [], shouldOfferFinalAdvice = false, wantsFinalAdvice = false, isEarlyConversation = false }) {
  const traits = Array.isArray(profile.traits) && profile.traits.length
    ? profile.traits.join(", ")
    : "입력 없음";

  const additionalPeople = Array.isArray(profile.additionalPeople) && profile.additionalPeople.length
    ? profile.additionalPeople.map((person, index) => {
        return `${index + 1}. ${person.label || `추가 인물 ${index + 1}`} / 관계: ${person.relation || "입력 없음"} / 성향: ${person.personality || "입력 없음"} / 상황에서의 역할: ${person.role || "입력 없음"}`;
      }).join("\n")
    : "입력 없음";

  const recentHistory = Array.isArray(history)
    ? history
        .slice(-8)
        .map((item) => `${item.role === "user" ? "사용자" : "AI"}: ${item.text}`)
        .join("\n")
    : "없음";

  return `
너는 "엠퍼"라는 대학생 사회관계 상담 챗봇이다.
목표는 사용자가 현실과 동떨어진 조언 때문에 불편감을 느끼지 않도록, 상대방의 성향과 실제 상황을 반영해 조심스럽고 실행 가능한 관계 조언을 제공하는 것이다.

중요한 답변 원칙:
- 진단, 단정, 조종, 가스라이팅성 조언을 하지 않는다.
- 상대방의 마음을 확정하지 말고 가능성으로 표현한다.
- 사용자가 실제로 할 수 있는 작은 행동을 제안한다.
- 답변은 친구와 고민을 나누는 것처럼 자연스럽고 대화체로 한다.
- 보고서, 과제 답안, 분석 리포트처럼 딱딱하게 쓰지 않는다.
- 번호가 붙은 긴 목록을 기본 형식으로 쓰지 않는다.
- 사용자의 감정에 먼저 짧게 반응하고, 그다음 현실적인 조언을 부드럽게 이어간다.
- 답변은 기본적으로 길지 않게 한다. 실제 친구와 카톡으로 고민을 주고받는 느낌에 가깝게, 3~5개의 짧은 문단 안에서 말한다.
- 한 번에 너무 많은 해결책을 나열하지 말고, 가장 해볼 만한 1~2가지만 제안한다.
- 대화 초반에는 바로 최종 해결책을 제시하지 말고, 사용자의 감정을 받아준 뒤 상황을 이해하기 위한 질문을 1개만 한다.
- 사용자가 아직 구체적인 배경을 충분히 말하지 않았다면 "어쩌다가 그렇게 된 거야?", "그걸 어떻게 알게 됐어?", "친구들은 뭐라고 했어?"처럼 자연스러운 후속 질문을 우선한다.
- 일반 상담 대화에서는 어떻게 말을 전달할지에 대한 구체적인 문장, 카톡 예시, 대화 스크립트, 단계별 전달법을 거의 제시하지 않는다.
- 구체적인 전달 문장과 행동 순서는 최대한 최종 조언 모드에서만 제시한다.
- 사용자가 일반 대화 중에 "어떻게 말하지", "뭐라고 보내지", "문장 알려줘"라고 해도 바로 문장을 만들어주지 말고, "그건 최종 조언에서 정리해줄 수 있어. 먼저..."처럼 말하며 필요한 맥락을 1개만 더 물어본다.
- 대화 초반에는 사용자가 "어떻게 말하지"라고 해도 바로 보낼 문장을 완성해주지 않는다. 먼저 왜 그런 일이 생겼는지, 사용자가 무엇을 알고 있는지, 상대가 설명했는지를 물어본다.
- 위험하거나 심각한 정서 위기 표현이 있으면 전문가, 학교 상담센터, 긴급 도움을 권한다.
- 답변은 한국어로 한다.
- 굵게 표시를 위한 ** 같은 마크다운 강조 기호를 쓰지 않는다.
- 목록이 필요하면 짧은 문장으로만 쓰고, 번호 제목을 길게 붙이지 않는다.
- 사용자가 "최종 조언", "정리해줘", "최종적으로 어떻게 해"처럼 요청하면 최종 조언 모드로 답한다.

상담 정보:
- 상황 분류: ${profile.category || "입력 없음"}
- MBTI: ${profile.mbti || "입력 없음"}
- 상대방 성격: ${profile.personality || "입력 없음"}
- 현장 분위기와 말투: ${profile.sceneTone || "입력 없음"}
- 상대방 성향 키워드: ${traits}
- 형성하고 싶은 관계: ${profile.desiredRelation || "입력 없음"}
- 구체적 상황: ${profile.situation || "입력 없음"}
- 사용자가 한 말과 행동: ${profile.myAction || "입력 없음"}
- 사용자가 생각하는 자신의 문제점: ${profile.selfIssue || "입력 없음"}
- 추가 인물 정보:
${additionalPeople}
- 추가 자료 내용: ${profile.extraMaterial || "입력 없음"}
- 첨부 파일명: ${Array.isArray(profile.extraFiles) && profile.extraFiles.length ? profile.extraFiles.join(", ") : "없음"}

최근 대화:
${recentHistory || "없음"}

사용자 질문:
${message}

답변 스타일:
- 첫 문장은 사용자의 고민에 공감하는 말로 시작한다.
- 전체 답변은 2~4개의 짧은 문단으로 구성한다.
- 자연스럽게 말하되, 상대 성향을 고려한 이유를 짧게 설명한다.
- 일반 상담 대화에서는 실제로 보낼 수 있는 말 예시를 포함하지 않는다.
- 마지막에는 너무 조급해하지 않아도 된다는 식의 현실적인 마무리를 한다.
- ${shouldOfferFinalAdvice ? '이번 답변 끝에는 자연스럽게 "원하면 내가 지금까지 얘기한 걸 바탕으로 최종 조언도 짧게 정리해줄까?"라는 취지의 문장을 덧붙인다.' : '아직 최종 조언 제안 문구를 억지로 붙이지 않는다.'}
- ${wantsFinalAdvice ? '지금은 최종 조언 모드다. 감정 분석, 상황 분석, 장황한 설명은 하지 않는다. 담백하게 어떻게 말하면 좋을지만 알려준다. 답변은 2~4문장으로 짧게 하고, 바로 사용할 수 있는 말 예시를 중심으로 제시한다.' : '지금은 일반 상담 대화 모드다. 구체적인 전달 문장, 카톡 예시, 단계별 행동 지시는 하지 않는다.'}
- ${isEarlyConversation && !wantsFinalAdvice ? '지금은 대화 초반이다. 답변은 공감 1~2문장 + 후속 질문 1개로 끝낸다. 해결책, 보낼 문장 예시, 최종 조언은 아직 제시하지 않는다.' : '대화가 어느 정도 진행된 상태라면 필요한 만큼 짧게 조언한다.'}
`.trim();
}

async function callGeminiModel({ model, profile, message, history, shouldOfferFinalAdvice, wantsFinalAdvice, isEarlyConversation }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다. .env 파일 이름과 내용을 확인해주세요.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt({ profile, message, history, shouldOfferFinalAdvice, wantsFinalAdvice, isEarlyConversation }) }],
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || "Gemini API 요청에 실패했습니다.";
    throw new Error(detail);
  }

  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim()
    || "답변을 생성하지 못했습니다. 다시 시도해주세요.";
}

async function callGemini({ profile, message, history, shouldOfferFinalAdvice, wantsFinalAdvice, isEarlyConversation }) {
  const errors = [];

  for (const model of modelList) {
    try {
      return await callGeminiModel({ model, profile, message, history, shouldOfferFinalAdvice, wantsFinalAdvice, isEarlyConversation });
    } catch (error) {
      errors.push(`${model}: ${error.message}`);

      const retryable = /high demand|overloaded|temporarily|try again later|quota exceeded|exceeded your current quota|rate-limit|rate limit|503|429/i.test(error.message);
      if (!retryable) break;
    }
  }

  throw new Error(errors.join(" / "));
}

async function handleApiChat(req, res) {
  try {
    const { profile, message, history } = await readJson(req);
    if (!message || typeof message !== "string") {
      return sendJson(res, 400, { error: "메시지가 비어 있습니다." });
    }

    const userMessageCount = Array.isArray(history)
      ? history.filter((item) => item.role === "user").length
      : 1;
    const wantsFinalAdvice = /최종\s*조언|최종적으로|최종\s*정리|정리해줘|결론\s*내줘|요약해줘/i.test(message);
    const shouldOfferFinalAdvice = userMessageCount >= 3 && !wantsFinalAdvice;
    const isEarlyConversation = userMessageCount <= 1;

    const reply = await callGemini({
      profile,
      message,
      history,
      shouldOfferFinalAdvice,
      wantsFinalAdvice,
      isEarlyConversation,
    });
    return sendJson(res, 200, { reply });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Gemini API 호출 중 오류가 발생했습니다." });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const normalizedPath = requestedPath === "/" ? "/social-fit-chatbot-prototype.html" : requestedPath;
  const cleanPath = normalizedPath.replace(/^\/+/, "");

  const candidates = [
    path.normalize(path.join(staticDir, cleanPath)),
    path.normalize(path.join(__dirname, cleanPath)),
  ];

  if (cleanPath.startsWith("assets/")) {
    candidates.push(path.normalize(path.join(staticDir, cleanPath)));
    candidates.push(path.normalize(path.join(__dirname, cleanPath)));
  }

  for (const filePath of candidates) {
    const isAllowed = filePath.startsWith(staticDir) || filePath.startsWith(__dirname);
    if (!isAllowed) continue;

    try {
      const file = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(file);
      return;
    } catch {
      // Try the next possible location.
    }
  }

  if (cleanPath === "social-fit-chatbot-prototype.html") {
    const found = await findFile(__dirname, "social-fit-chatbot-prototype.html");
    if (found) {
      const file = await fs.readFile(found);
      res.writeHead(200, { "Content-Type": contentType(found) });
      res.end(file);
      return;
    }
  }

  res.writeHead(404);
  res.end("Not found");
}

async function findFile(dir, targetName) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === targetName) return fullPath;

    if (entry.isDirectory()) {
      const found = await findFile(fullPath, targetName);
      if (found) return found;
    }
  }

  return "";
}

await loadEnv();

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") {
    handleApiChat(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`엠퍼 server running at http://localhost:${port}/social-fit-chatbot-prototype.html`);
  console.log(`Gemini model fallback order: ${modelList.join(" -> ")}`);
});
