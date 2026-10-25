import type { ChatMessage, ThreadIndex } from "./agent.js";

/** Ordinary assistant text; never an executable command or a tool call. */
export const modelQuestionInstruction = `When user confirmation is needed, wrap each question and its numbered options in <Question type="single">...</Question> for single choice or <Question type="multiple">...</Question> for multiple choices. Put each opening and closing tag on its own line, with the question first and one option per line using 1., 2., etc. For several questions, output a separate Question block for each in the same reply. Use short option labels; when clarification is useful, add a description on following lines indented by two spaces, explaining meaning, trade-offs or when to choose it. Output these blocks directly, not inside code fences, then wait for the user's reply.`;
export interface ModelQuestion {
  type: "single" | "multiple";
  question: string;
  options: string[];
  /** Optional plain-text descriptions aligned with options; empty entries have none. */
  descriptions?: string[];
}
export interface QuestionAnswer { selected: number[]; text: string }
export interface ParsedQuestions { text: string; questions: ModelQuestion[] }

/** Recognize standalone tags outside Markdown fences. Invalid/partial blocks
 * stay as ordinary text; never guess at a broken question or execute content. */
export function parseModelQuestions(text: string): ParsedQuestions | null {
  if (text.length > 100_000) return null;
  const lines = text.split(/\r?\n/), prose: string[] = [], questions: ModelQuestion[] = [];
  let fence: { char: string; size: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      prose.push(line);
      const close = /^ {0,3}(`+|~+)\s*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.size) fence = undefined;
      continue;
    }
    const openFence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (openFence) { fence = { char: openFence[1][0], size: openFence[1].length }; prose.push(line); continue; }
    const open = /^<Question\s+type=["'](single|multiple)["']\s*>\s*$/.exec(line);
    if (!open) {
      if (/^\s*<\/?Question\b/.test(line)) return null;
      prose.push(line); continue;
    }
    const title: string[] = [], options: string[] = [], descriptions: string[] = [];
    let closed = false;
    for (i++; i < lines.length; i++) {
      const body = lines[i].trim();
      if (body === "</Question>") { closed = true; break; }
      if (!body) continue;
      if (/<\/?Question\b/.test(body)) return null;
      const option = /^(\d+)[.)、]\s*(\S.*)$/.exec(body);
      if (option) {
        if (Number(option[1]) !== options.length + 1 || option[2].length > 2000) return null;
        options.push(option[2]);
        descriptions.push("");
      } else if (options.length && /^(?: {2,}|\t)/.test(lines[i])) {
        const last = options.length - 1;
        descriptions[last] += `${descriptions[last] ? "\n" : ""}${body}`;
        if (descriptions[last].length > 4000) return null;
      } else if (!options.length) title.push(body);
      else return null;
    }
    const question = title.join("\n");
    if (!closed || !question || question.length > 2000 || options.length < 2 || options.length > 20 ||
      new Set(options).size !== options.length || questions.length >= 12) return null;
    questions.push({ type: open[1] as ModelQuestion["type"], question, options,
      ...(descriptions.some(Boolean) ? { descriptions } : {}) });
  }
  return questions.length ? { text: prose.join("\n").trim(), questions } : null;
}
export function questionMessageComplete(message: ChatMessage): boolean {
  return message.role === "assistant" && message.phase === "final_answer" && !message.streaming &&
    (!message.status || message.status === "completed") && !message.error && !message.calls?.length &&
    !message.compression && !message.taskNotice &&
    // Bounded previews may truncate thinking while preserving the entire reply.
    (!message.truncated || message.textLength === message.text.length) &&
    (message.textLength === undefined || message.textLength === message.text.length);
}
export function questionIsCurrent(messageId: string, index: ThreadIndex): boolean {
  return index.ids.at(-1) === messageId && !["starting", "running", "stopping"].includes(index.runStatus ?? "");
}
export function questionAnswered(question: ModelQuestion, answer?: QuestionAnswer): boolean {
  if (!answer) return false;
  const valid = answer.selected.length <= (question.type === "single" ? 1 : question.options.length) &&
    new Set(answer.selected).size === answer.selected.length && answer.selected.every(i => Number.isInteger(i) && i >= 0 && i < question.options.length);
  return valid && (!!answer.selected.length || !!answer.text.trim());
}
export function modelQuestionsReply(questions: ModelQuestion[], answers: QuestionAnswer[]): string | null {
  if (!questions.length || questions.some((question, i) => !questionAnswered(question, answers[i]))) return null;
  return questions.map((question, i) => {
    const answer = answers[i];
    return [`问题 ${i + 1}：${question.question}`,
      ...[...answer.selected].sort((a, b) => a - b).map(index => `选择：${index + 1}. ${question.options[index]}`),
      ...(answer.text.trim() ? [`${answer.selected.length ? "补充" : "我的回答"}：${answer.text.trim()}`] : [])].join("\n");
  }).join("\n\n");
}
