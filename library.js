export const KEY = 'promptvault.library.v1';
export const CATEGORIES = ['Writing', 'Coding', 'Learning', 'Research', 'General'];
export const LIMIT = 250;

export function validatePrompt(value) {
  if (!value || typeof value.title !== 'string' || typeof value.body !== 'string') throw new Error('Every prompt needs a title and body.');
  const title = value.title.trim();
  const body = value.body;
  if (!title || !body.trim()) throw new Error('Add both a title and a prompt.');
  if (title.length > 80) throw new Error('Titles can contain up to 80 characters.');
  if (body.length > 20000) throw new Error('Prompts can contain up to 20,000 characters.');
  return { title, body, category: CATEGORIES.includes(value.category) ? value.category : 'General', favorite: value.favorite === true };
}

export function parseBackup(value) {
  if (!value || value.format !== 'promptvault' || value.version !== 1 || !Array.isArray(value.prompts)) throw new Error('Choose a PromptVault version 1 JSON backup.');
  if (value.prompts.length > LIMIT) throw new Error(`A backup can contain up to ${LIMIT} prompts.`);
  return value.prompts.map(validatePrompt);
}

export function selectPrompts(prompts, query = '', category = 'All', favorites = false) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return prompts.filter(p => (category === 'All' || p.category === category) && (!favorites || p.favorite) && words.every(w => `${p.title} ${p.body} ${p.category}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

export function starterPrompts() {
  const examples = [
    { title: 'The thoughtful code reviewer', category: 'Coding', favorite: true, body: 'Act as a senior software engineer reviewing my code. First summarize what it does, then identify correctness bugs, edge cases, and security risks. Prioritize findings by impact and explain each with a concrete example. Suggest a minimal fix and a meaningful test. If context is missing, ask instead of assuming.\n\nCode to review:\n' },
    { title: 'Learn it from first principles', category: 'Learning', favorite: true, body: 'Help me understand the topic below from first principles. Start with a simple explanation and one concrete analogy. Build up to a worked example, explain common misconceptions, and finish with three questions that test my understanding. Ask about my current knowledge if needed.\n\nTopic:\n' },
    { title: 'Turn rough notes into clear writing', category: 'Writing', body: 'Edit the notes below into clear, concise writing. Preserve the meaning and my voice. Use plain language, remove repetition, and organize the ideas logically. Do not invent facts. Flag any unclear claims and explain the three most useful edits.\n\nMy notes:\n' },
    { title: 'Research with evidence', category: 'Research', body: 'Investigate the question below. Separate established facts, interpretations, and open questions. Cite primary sources when available and clearly mark anything you cannot verify. Compare competing explanations and finish with a practical next step.\n\nResearch question:\n' }
  ];
  return examples.map((p, i) => ({ ...validatePrompt(p), id: crypto.randomUUID(), createdAt: Date.now() - i, updatedAt: Date.now() - i }));
}
