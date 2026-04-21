import os
import tempfile
import email

try:
    import extract_msg
except ImportError:
    extract_msg = None

def parse_email(file_path, display_name, parse_callback):
    ext = os.path.splitext(display_name)[1].lower()
    output = [f"📧 邮件: {display_name}"]
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
                    payload = part.get_payload(decode=True).decode(
                        part.get_content_charset() or 'utf-8', errors='ignore'
                    )
                    if content_type == "text/html":
                        from bs4 import BeautifulSoup
                        payload = BeautifulSoup(payload, 'html.parser').get_text(separator='\n', strip=True)
                    body += payload + "\n"
                except:
                    pass

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

    # 递归处理所有附件（通过回调）
    if attachments:
        output.append(f"📦 发现 {len(attachments)} 个附件，开始自动提取...")
        for filename, payload in attachments:
            fd, tmp_path = tempfile.mkstemp(suffix=os.path.splitext(filename)[1])
            os.close(fd)
            try:
                with open(tmp_path, 'wb') as f:
                    f.write(payload)
                # 使用回调触发通用解析管道
                res = parse_callback(tmp_path, display_name=filename)
                if res:
                    output.append(f"\n📎 附件 [{filename}]:\n{res}")
            except Exception as e:
                output.append(f"❌ 附件 [{filename}] 解析跳过: {str(e)}")
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

    return "\n".join(output)