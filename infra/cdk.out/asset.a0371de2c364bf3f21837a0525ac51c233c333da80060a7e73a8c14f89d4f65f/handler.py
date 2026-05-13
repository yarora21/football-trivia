def handler(event, context):
    # Step 7 will replace this with a real Bedrock call.
    # Return enough mock questions to satisfy the requested count.
    question_count = int(event.get('question_count', 10))

    mock_question = {
        'prompt': 'Which team won Super Bowl LVIII?',
        'choices': ['Kansas City Chiefs', 'San Francisco 49ers', 'Baltimore Ravens', 'Detroit Lions'],
        'correct_index': 0,
        'difficulty': 'easy',
    }

    return {
        **event,
        'questions': [mock_question] * question_count,
    }
