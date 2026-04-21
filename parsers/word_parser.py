import os

def parse_word(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == '.docx':
        from docx import Document
        doc = Document(file_path)
        return "\n".join([p.text for p in doc.paragraphs])
        
    elif ext == '.doc':
        try:
            import win32com.client
            word = win32com.client.Dispatch("Word.Application")
            word.Visible = False
            abs_path = os.path.abspath(file_path)
            doc = word.Documents.Open(abs_path)
            text = doc.Content.Text
            doc.Close()
            word.Quit()
            return text
        except Exception as e:
            raise RuntimeError(f"读取 .doc 失败: {str(e)}")