import os
import tempfile
import email
import shutil

try:
    import extract_msg
except ImportError:
    extract_msg = None

def parse_email(file_path, display_name, parse_callback):
    ext = os.path.splitext(display_name)[1].lower()
    output = [f"📧 邮件: {display_name}"]
    attachments = []
    
    tmp_dir = tempfile.mkdtemp()
    try:
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
                    payload = part.get_payload(decode=True)
                    if payload:
                        att_path = os.path.join(tmp_dir, filename)
                        with open(att_path, 'wb') as f:
                            f.write(payload)
                        attachments.append((filename, att_path))

        elif ext == '.msg':
            if extract_msg is None:
                return "❌ 缺少 extract-msg 库，无法解析 .msg"
            
            try:
                msg = extract_msg.Message(file_path)
                if msg.body:
                    output.extend(["\n--- 邮件正文 ---", msg.body, "-----------------\n"])
                
                for attachment in msg.attachments:
                    try:
                        filename = attachment.longFilename or attachment.shortFilename or 'unknown_attachment.bin'
                        att_path = os.path.join(tmp_dir, filename)
                        
                        # 重点修正：使用 save 方法能够原生支持将嵌套内的 .msg 文件或其他非常规附件安全落盘
                        attachment.save(customPath=tmp_dir, customFilename=filename)
                        
                        if os.path.exists(att_path):
                            attachments.append((filename, att_path))
                    except Exception as e:
                        output.append(f"❌ 附件 [{filename}] 提取失败: {str(e)}")
                msg.close()
            except Exception as e:
                output.append(f"❌ 解析 .msg 发生错误: {str(e)}")

        # 递归处理所有附件（利用回调传递给全局调度系统）
        if attachments:
            output.append(f"\n📦 发现 {len(attachments)} 个附件，开始自动提取...")
            for filename, att_path in attachments:
                try:
                    res = parse_callback(att_path, display_name=filename)
                    if res:
                        # 给嵌套内容加上缩进层级以更好区分结构
                        indented_res = "\n".join("    " + line for line in res.split("\n"))
                        output.append(f"\n📎 附件 [{filename}]:\n{indented_res}")
                except Exception as e:
                    output.append(f"❌ 附件 [{filename}] 解析跳过: {str(e)}")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return "\n".join(output)
