"""Exact, bounded source excerpts for constrained JSON generation."""
import re


def literal_excerpts(text):
    excerpts = []
    for match in re.finditer(r'[^.!?\n]+[.!?]*', text):
        sentence = match.group().strip()
        while sentence:
            end = min(200, len(sentence))
            if end < len(sentence):
                boundary = sentence.rfind(' ', 0, end)
                if boundary > 0: end = boundary
            excerpt = sentence[:end].strip()
            if excerpt: excerpts.append(excerpt)
            sentence = sentence[end:].strip()
    return list(dict.fromkeys(excerpts))


def reference_catalog(records, source_key):
    """Bind short references to exact source/quote pairs, without changing text."""
    catalog, seen = [], set()
    for record in records:
        pair = (record[source_key], record['quote'])
        if pair in seen:
            continue
        seen.add(pair)
        catalog.append({'reference_id': 'r' + str(len(catalog) + 1),
                        source_key: pair[0], 'quote': pair[1]})
    return catalog


def reference_schema(catalog):
    """Only short IDs enter the provider schema; source text remains input data."""
    return {'type': 'object', 'additionalProperties': False,
            'properties': {'reference_id': {'type': 'string',
                'enum': [record['reference_id'] for record in catalog]}},
            'required': ['reference_id']}


def resolve_reference(reference, catalog, source_key, error_code):
    from .contracts import PipelineError
    if not isinstance(reference, dict) or set(reference) != {'reference_id'}:
        raise PipelineError(error_code)
    identity = reference['reference_id']
    if not isinstance(identity, str):
        raise PipelineError(error_code)
    record = next((record for record in catalog if record['reference_id'] == identity), None)
    if record is None:
        raise PipelineError(error_code)
    return {source_key: record[source_key], 'quote': record['quote']}
