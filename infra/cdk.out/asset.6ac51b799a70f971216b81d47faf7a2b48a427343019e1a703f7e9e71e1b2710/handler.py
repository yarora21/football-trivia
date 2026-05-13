def handler(event, context):
    # Step 6 will replace this with a real ESPN API call.
    # For now return mock grounding facts so the rest of the pipeline can run.
    return {
        **event,
        'grounding_facts': (
            'Mock NFL data: The Kansas City Chiefs won Super Bowl LVIII. '
            'Patrick Mahomes leads the league in passing yards. '
            'The San Francisco 49ers finished second in the NFC.'
        ),
    }
