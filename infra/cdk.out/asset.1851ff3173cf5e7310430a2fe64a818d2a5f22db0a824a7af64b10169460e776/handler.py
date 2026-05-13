import json
import boto3

bedrock = boto3.client('bedrock-runtime')

_SYSTEM_PROMPT = (
    'You are an American football (NFL) trivia question writer. '
    'Generate factually accurate, unambiguous multiple-choice questions about American football. '
    'Output strict JSON only — no preamble, no markdown.\n\n'
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
}}"""


def handler(event, context):
    topic = event.get('topic', '')
    question_count = int(event.get('question_count', 10))
    grounding_facts = event.get('grounding_facts', '')

    user_message = _USER_PROMPT.format(
        n=question_count,
        topic=topic,
        grounding_facts=grounding_facts,
    )

    response = bedrock.invoke_model(
        modelId='anthropic.claude-sonnet-4-20250514-v1:0',
        contentType='application/json',
        accept='application/json',
        body=json.dumps({
            'anthropic_version': 'bedrock-2023-05-31',
            'max_tokens': 4096,
            'system': _SYSTEM_PROMPT,
            'messages': [
                {'role': 'user', 'content': user_message},
            ],
        }),
    )

    body = json.loads(response['body'].read())
    raw_text = body['content'][0]['text']

    # Parse the JSON response from Claude
    parsed = json.loads(raw_text)
    questions = parsed['questions']

    return {
        **event,
        'questions': questions,
    }
