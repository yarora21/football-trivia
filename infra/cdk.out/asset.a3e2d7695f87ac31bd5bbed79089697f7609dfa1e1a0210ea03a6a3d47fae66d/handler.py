def handler(event, context):
    # Step 7 will replace this with a real Bedrock call.
    # Return varied mock questions that pass validation.
    question_count = int(event.get('question_count', 10))

    templates = [
        {'prompt': 'Which team won Super Bowl LVIII?', 'choices': ['Kansas City Chiefs', 'San Francisco 49ers', 'Baltimore Ravens', 'Detroit Lions'], 'correct_index': 0, 'difficulty': 'easy'},
        {'prompt': 'Who was the MVP of Super Bowl LVIII?', 'choices': ['Patrick Mahomes', 'Travis Kelce', 'Brock Purdy', 'Lamar Jackson'], 'correct_index': 0, 'difficulty': 'easy'},
        {'prompt': 'How many Super Bowls have the Chiefs won?', 'choices': ['4', '3', '2', '1'], 'correct_index': 0, 'difficulty': 'easy'},
        {'prompt': 'Which QB led the league in passing yards in 2023?', 'choices': ['Tua Tagovailoa', 'Patrick Mahomes', 'Dak Prescott', 'Jared Goff'], 'correct_index': 0, 'difficulty': 'medium'},
        {'prompt': 'Which team had the best regular season record in the AFC in 2023?', 'choices': ['Baltimore Ravens', 'Kansas City Chiefs', 'Buffalo Bills', 'Miami Dolphins'], 'correct_index': 0, 'difficulty': 'medium'},
        {'prompt': 'Who led the NFL in rushing yards in 2023?', 'choices': ['Derrick Henry', 'Christian McCaffrey', 'Josh Jacobs', 'Raheem Mostert'], 'correct_index': 0, 'difficulty': 'medium'},
        {'prompt': 'Which team drafted Caleb Williams first overall in 2024?', 'choices': ['Chicago Bears', 'Washington Commanders', 'New England Patriots', 'Arizona Cardinals'], 'correct_index': 0, 'difficulty': 'medium'},
        {'prompt': 'Which stadium hosted Super Bowl LVIII?', 'choices': ['Allegiant Stadium', 'SoFi Stadium', 'State Farm Stadium', 'Hard Rock Stadium'], 'correct_index': 0, 'difficulty': 'medium'},
        {'prompt': 'What is the longest field goal in NFL history?', 'choices': ['66 yards', '64 yards', '63 yards', '61 yards'], 'correct_index': 0, 'difficulty': 'hard'},
        {'prompt': 'Which player holds the record for most career touchdowns?', 'choices': ['Jerry Rice', 'Emmitt Smith', 'Tom Brady', 'LaDainian Tomlinson'], 'correct_index': 0, 'difficulty': 'hard'},
    ]

    # Cycle through templates if more questions are requested
    questions = [templates[i % len(templates)] for i in range(question_count)]

    return {
        **event,
        'questions': questions,
    }
