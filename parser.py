import sys
import os
import io
import email
import tempfile

try:
    import extract_msg
except ImportError:
    extract_msg = None

# 安全地设置 UTF-8 编码，避免重复包裹导致底层流被关闭
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

def parse_file_to_text(file_path, display_name=None):
    """通用解析管道：返回提取出的纯文本，支持递归调用"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    actual_name = display_name or os.path.basename(file_path)
    ext = os.path.splitext(actual_name)[1].lower()
    
    # 1. 邮件解析 (正文 + 附件递归)
    if ext in ['.eml', '.msg']:
        output = [f"📧 邮件: {actual_name}"]
        attachments = []
        
        if ext == '.eml':
            with open(file_path, 'rb') as f:
                msg = email.message_from_binary_file(f)
            
            body = ""
            for part in msg.walk():
                content_type = part.get_content_type()
                disp = str(part.get('Content-Disposition'))
                
                if content_type in ["text/plain", "text/html"] and "attachment" not in disp:
                    try:
                        payload = part.get_payload(decode=True).decode(part.get_content_charset() or 'utf-8', errors='ignore')
                        if content_type == "text/html":
                            from bs4 import BeautifulSoup
                            payload = BeautifulSoup(payload, 'html.parser').get_text(separator='\n', strip=True)
                        body += payload + "\n"
                    except: pass
            if body.strip():
                output.extend(["\n--- 邮件正文 ---", body.strip(), "-----------------\n"])
                
            for part in msg.walk():
                if part.get_content_maintype() == 'multipart' or part.get('Content-Disposition') is None:
                    continue
                filename = part.get_filename()
                if filename:
                    attachments.append((filename, part.get_payload(decode=True)))
                    
        elif ext == '.msg':
            if extract_msg is None:
                return "❌ 缺少 extract-msg 库，无法解析 .msg"
            msg = extract_msg.Message(file_path)
            if msg.body:
                output.extend(["\n--- 邮件正文 ---", msg.body, "-----------------\n"])
            for attachment in msg.attachments:
                filename = attachment.longFilename or attachment.shortFilename
                if filename:
                    attachments.append((filename, attachment.data))
        
        # 递归处理所有附件
        if attachments:
            output.append(f"📦 发现 {len(attachments)} 个附件，开始自动提取...")
            for filename, payload in attachments:
                # 使用临时文件保存附件，走一遍相同的解析流程
                fd, tmp_path = tempfile.mkstemp(suffix=os.path.splitext(filename)[1])
                os.close(fd)
                try:
                    with open(tmp_path, 'wb') as f:
                        f.write(payload)
                    res = parse_file_to_text(tmp_path, display_name=filename)
                    if res:
                        output.append(f"\n📎 附件 [{filename}]:\n{res}")
                except Exception as e:
                    output.append(f"❌ 附件 [{filename}] 解析跳过: {str(e)}")
                finally:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                        
        return "\n".join(output)

    # 2. 二进制文件拦截
    binary_exts = ['.exe', '.dll', '.so', '.bin', '.zip', '.rar', '.7z', '.tar', '.gz', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4']
    if ext in binary_exts:
        raise ValueError(f"暂不支持解析媒体或二进制文件: {ext}")

    # 3. PDF 解析
    if ext == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        return "\n".join([p.extract_text() for p in reader.pages if p.extract_text()])
        
    # 4. Word 解析
    elif ext == '.docx':
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
            
    # 5. PPT 解析
    elif ext == '.pptx':
        from pptx import Presentation
        prs = Presentation(file_path)
        text_runs = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text"):
                    text_runs.append(shape.text)
        return "\n".join(text_runs)
    elif ext == '.ppt':
        try:
            import win32com.client
            powerpoint = win32com.client.Dispatch("PowerPoint.Application")
            abs_path = os.path.abspath(file_path)
            prs = powerpoint.Presentations.Open(abs_path, WithWindow=False)
            text_runs = []
            for slide in prs.Slides:
                for shape in slide.Shapes:
                    if shape.HasTextFrame and shape.TextFrame.HasText:
                        text_runs.append(shape.TextFrame.TextRange.Text)
            prs.Close()
            powerpoint.Quit()
            return "\n".join(text_runs)
        except Exception as e:
            raise RuntimeError(f"读取 .ppt 失败: {str(e)}")
            
    # 6. 表格解析
    elif ext in ['.xlsx', '.xls', '.csv']:
        import pandas as pd
        if ext == '.csv':
            for enc in ['utf-8', 'gbk', 'utf-16', 'gb2312', 'latin1']:
                try:
                    df = pd.read_csv(file_path, encoding=enc)
                    break
                except: continue
        else:
            try:
                if ext == '.xlsx':
                    df = pd.read_excel(file_path, engine="openpyxl")
                else:
                    df = pd.read_excel(file_path, engine="xlrd")
            except Exception:
                df = pd.read_excel(file_path)
        
        df_clean = df.fillna("").astype(str)
        md_lines = [f"### 📄 表格：{actual_name}", ""]
        
        if df_clean.empty:
            md_lines.append("（空表格）")
        else:
            header = "| " + " | ".join([str(col).replace('\n', ' ') for col in df_clean.columns]) + " |"
            separator = "| " + " | ".join(["---"] * len(df_clean.columns)) + " |"
            md_lines.append(header)
            md_lines.append(separator)
            for _, row in df_clean.iterrows():
                row_str = "| " + " | ".join([str(cell).replace('\n', '<br>') for cell in row]) + " |"
                md_lines.append(row_str)
        
        return "\n".join(md_lines)

    # 7. 网页及 XML
    elif ext in ['.html', '.htm', '.xml']:
        from bs4 import BeautifulSoup
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            soup = BeautifulSoup(f.read(), 'html.parser')
            return soup.get_text(separator='\n', strip=True)

    # 8. 富文本
    elif ext == '.rtf':
        from striprtf.striprtf import rtf_to_text
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return rtf_to_text(f.read())

    # 9. 电子书
    elif ext == '.epub':
        import ebooklib
        from ebooklib import epub
        from bs4 import BeautifulSoup
        book = epub.read_epub(file_path)
        texts = []
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            soup = BeautifulSoup(item.get_body_content(), 'html.parser')
            texts.append(soup.get_text(separator='\n', strip=True))
        return "\n".join(texts)
        
    # 10. 兜底纯文本解析
    else:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            with open(file_path, 'r', encoding='gbk', errors='ignore') as f:
                return f.read()

def parse():
    if len(sys.argv) < 2:
        return
    
    file_path = sys.argv[1]
    try:
        result = parse_file_to_text(file_path)
        if result:
            print(result)
    except Exception as e:
        sys.stderr.write(f"解析异常: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    parse()
