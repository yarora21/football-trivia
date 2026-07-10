import json
import boto3
from aws_xray_sdk.core import patch_all

patch_all()

bedrock = boto3.client('bedrock-runtime')

_SYSTEM_PROMPT = (
    'You are an American football (NFL) trivia question writer. '
    'Generate factually accurate, unambiguous multiple-choice questions about American football. '
    'Output strict JSON only — no preamble, no markdown, no code fences.\n\n'
    'Important: "Football" in this context always means American football / NFL. '
    'Never produce questions about soccer, association football, or any other sport.'
)

_USER_PROMPT = """Generate {n} NFL trivia questions about: "{topic}".

Use the following grounding facts as your source of truth. Do not invent facts not supported by these:
{grounding_facts}

Requirements:
- Each question has exactly 4 answer choices.
- Exactly one choice is correct.
- Mix of difficulties: 30% easy, 50% medium, 20% hard.
- Avoid questions answerable by general knowledge alone — they must require NFL knowledge.
- No "all of the above" or "none of the above".
- For "who" questions, choices must be player or team names — NEVER raw stats or numbers.
- Wrong choices should be plausible (same position, same era) but clearly different from the correct answer.
- Use the player profiles (college, draft, birthplace, etc.) to create diverse question types, not just stat-based questions.
- Question prompts under 200 characters. Choices under 80 characters.
- Use standard NFL terminology (touchdowns, sacks, interceptions, yards, etc.) — not soccer terms.

Return JSON matching this schema:
{{
  "questions": [
    {{
      "prompt": "string",
      "choices": ["A", "B", "C", "D"],
      "correct_index": 0,
      "difficulty": "easy" | "medium" | "hard"
    }}
  ]
}}

Output ONLY the JSON object. No other text."""


def handler(event, context):
    topic = event.get('topic', '')
    question_count = int(event.get('question_count', 5))
    grounding_facts = event.get('grounding_facts', '')

    user_message = _USER_PROMPT.format(
        n=question_count,
        topic=topic,
        grounding_facts=grounding_facts,
    )

    response = bedrock.invoke_model(
        modelId='amazon.nova-pro-v1:0',
        contentType='application/json',
        accept='application/json',
        body=json.dumps({
            'system': [{'text': _SYSTEM_PROMPT}],
            'messages': [
                {'role': 'user', 'content': [{'text': user_message}]},
            ],
            'inferenceConfig': {
                'max_new_tokens': 4096,
                'temperature': 0.7,
            },
        }),
    )

    body = json.loads(response['body'].read())
    raw_text = body['output']['message']['content'][0]['text']
    print('RAW RESPONSE:', raw_text[:500])

    # Strip markdown code fences if the model wrapped the JSON
    text = raw_text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1]
        text = text.rsplit('```', 1)[0]
        text = text.strip()

    parsed = json.loads(text)
    questions = parsed['questions']

    return {
        **event,
        'questions': questions,
    }
