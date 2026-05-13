const HTTP_URL = import.meta.env.VITE_HTTP_URL as string;

export async function createRoom(topic: string, questionCount = 10): Promise<string> {
  const res = await fetch(`${HTTP_URL}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, question_count: questionCount }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed: ${res.status}`);
  }

  const data = await res.json();
  return data.room_code as string;
}
