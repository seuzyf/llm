import pandas as pd
import os
import sys
import io

# 设置 UTF-8 编码支持，确保在终端输出中文不乱码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def read_single_excel(file_path):
    """核心功能：无乱码读取单个中文 Excel（xlsx/xls），返回结构化 Markdown 内容"""
    # 1. 校验文件存在性
    if not os.path.exists(file_path):
        return f"❌ 错误：文件不存在 → {file_path}"
    
    # 2. 适配格式读取，保证中文无乱码
    try:
        if file_path.lower().endswith(".xlsx"):
            df = pd.read_excel(file_path, engine="openpyxl")
        elif file_path.lower().endswith(".xls"):
            # 对于 xls 文件，使用 xlrd 读取
            import xlrd
            xls_book = xlrd.open_workbook(file_path, formatting_info=False)
            xls_sheet = xls_book.sheet_by_index(0)
            
            # 手动构建数据列表
            data = []
            for i in range(xls_sheet.nrows):
                row = xls_sheet.row_values(i)
                data.append(row)
            
            if data:
                # 假设第一行为表头
                df = pd.DataFrame(data[1:], columns=data[0])
            else:
                df = pd.DataFrame()
        else:
            return f"❌ 错误：仅支持 xlsx/xls 格式 → {file_path}"
    except Exception as e:
        return f"❌ Excel 读取失败 [{file_path}]：{str(e)}"
    
    # 3. 处理空值，生成结构化 Markdown
    df_clean = df.fillna("").astype(str)
    
    # 如果表格为空的处理
    if df_clean.empty:
        return f"### 📄 {os.path.basename(file_path)}\n⚠️ 该文件内容为空。\n"

    md_lines = [f"### 📄 {os.path.basename(file_path)}", ""]
    
    # 构建 Markdown 表头
    header = "| " + " | ".join([str(col) for col in df_clean.columns]) + " |"
    separator = "| " + " | ".join(["---"] * len(df_clean.columns)) + " |"
    md_lines.append(header)
    md_lines.append(separator)
    
    # 构建行内容
    for _, row in df_clean.iterrows():
        row_str = "| " + " | ".join([str(cell).replace("\n", " ") for cell in row]) + " |"
        md_lines.append(row_str)
    
    # 基础信息统计
    md_lines.append("")
    md_lines.append(f"📂 路径：{file_path} | 📊 行数：{len(df_clean)} | 列数：{len(df_clean.columns)}")
    md_lines.append("\n---")  # 分隔符
    
    return "\n".join(md_lines)

def traverse_folder(folder_path):
    """遍历文件夹，读取所有 xlsx/xls 文件"""
    if not os.path.isdir(folder_path):
        return f"❌ 错误：不是有效文件夹 → {folder_path}"
    
    excel_files = []
    for file_name in os.listdir(folder_path):
        if file_name.lower().endswith((".xlsx", ".xls")):
            excel_files.append(os.path.join(folder_path, file_name))
    
    if not excel_files:
        return f"⚠️ 文件夹 [{folder_path}] 下未找到任何 xlsx/xls 文件"
    
    folder_output = [f"## 📁 文件夹：{folder_path}（共 {len(excel_files)} 个文件）\n"]
    for file in excel_files:
        file_output = read_single_excel(file)
        folder_output.append(file_output)
    
    return "\n".join(folder_output)

def main():
    """主程序入口"""
    if len(sys.argv) < 2:
        print("❌ 使用方式错误。请输入 Excel 文件路径或文件夹路径。")
        print("示例：")
        print("  python script.py ./data.xlsx")
        print("  python script.py ./my_folder/")
        sys.exit(1)
    
    input_path = sys.argv[1]
    
    print("\n" + "="*60)
    print("📊 正在提取 Excel 内容...")
    print("="*60 + "\n")

    if os.path.isfile(input_path):
        result = read_single_excel(input_path)
    elif os.path.isdir(input_path):
        result = traverse_folder(input_path)
    else:
        result = f"❌ 错误：路径不存在 → {input_path}"
    
    print(result)
    print("\n" + "="*60)
    print("✅ 内容提取完成")
    print("="*60)

if __name__ == "__main__":
    main()
