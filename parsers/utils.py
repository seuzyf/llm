def indent(text: str, prefix: str = "  ") -> str:
    """给多行文本统一缩进"""
    return "\n".join(prefix + line for line in text.splitlines())