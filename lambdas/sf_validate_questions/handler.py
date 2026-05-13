class QuestionsFailedValidation(Exception):
    pass


def handler(event, context):
    questions = event.get('questions', [])
    question_count = int(event.get('question_count', 10))

    if len(questions) != question_count:
        raise QuestionsFailedValidation(
            f'Expected {question_count} questions, got {len(questions)}'
        )

    for i, q in enumerate(questions):
        choices = q.get('choices', [])
        if len(choices) != 4:
            raise QuestionsFailedValidation(f'Question {i} has {len(choices)} choices, expected 4')

        correct_index = q.get('correct_index')
        if correct_index not in (0, 1, 2, 3):
            raise QuestionsFailedValidation(f'Question {i} has invalid correct_index: {correct_index}')

        normalized = [c.strip().lower() for c in choices]
        if len(set(normalized)) != 4:
            raise QuestionsFailedValidation(f'Question {i} has duplicate choices')

        if len(q.get('prompt', '')) > 200:
            raise QuestionsFailedValidation(f'Question {i} prompt exceeds 200 characters')

        if any(len(c) > 80 for c in choices):
            raise QuestionsFailedValidation(f'Question {i} has a choice exceeding 80 characters')

    prompts = [q.get('prompt', '') for q in questions]
    if len(set(prompts)) != len(prompts):
        raise QuestionsFailedValidation('Duplicate question prompts found')

    difficulties = [q.get('difficulty') for q in questions]
    for d in ('easy', 'medium', 'hard'):
        if difficulties.count(d) > len(questions) * 0.5:
            raise QuestionsFailedValidation(f'More than 50% of questions have difficulty: {d}')

    return event
