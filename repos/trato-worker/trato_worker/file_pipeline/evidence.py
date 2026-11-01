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
