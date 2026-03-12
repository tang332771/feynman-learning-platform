import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';
import { useTheme } from '../context/ThemeContext';

// 客户端渲染的 Mermaid 组件：把 mermaid 源码渲染成 SVG 并注入
function MermaidChart({ chart }) {
    const [svg, setSvg] = useState(null);
    const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`);
    const { theme } = useTheme();

    useEffect(() => {
        let mounted = true;
        const renderMermaid = async () => {
            try {
                const code = String(chart).trim();
                // 确保已经初始化（防止某些时序下 mermaid 尚未初始化）
                try { 
                    mermaid.initialize({ 
                        startOnLoad: false,
                        theme: theme === 'dark' ? 'dark' : 'default',
                        securityLevel: 'loose',
                    }); 
                } catch { /* ignore */ }
                
                // 兼容不同 mermaid 版本：有的版本返回 Promise/对象，有的使用回调
                const res = await mermaid.render(idRef.current, code);
                const svgCode = res && typeof res === 'object' && res.svg ? res.svg : res;
                if (mounted) setSvg(svgCode);
            } catch (err) {
                // 回退到回调形式（某些旧版本）
                try {
                    mermaid.render(idRef.current, String(chart).trim(), (svgCode) => {
                        if (mounted) setSvg(svgCode);
                    });
                } catch (err2) {
                    console.error('Mermaid render error (both promise and callback attempts failed):', err, err2);
                }
            }
        };
        renderMermaid();
        return () => { mounted = false; };
    }, [chart, theme]);

    if (!svg) return <div>渲染中...</div>;
    return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

// 简单判断字符串是否包含 HTML 标签
const looksLikeHtml = (str) => {
    if (!str || typeof str !== 'string') return false;
    // 如果包含像 <p>、<div>、<img ...> 等标签，认为是 HTML
    return /<[^>]+>/i.test(str);
};

// 判断字符串是否包含 Markdown 数学公式标记（行内 $...$ 或 块级 $$...$$）
const containsMath = (str) => {
    if (!str || typeof str !== 'string') return false;
    return /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/m.test(str);
};

// 如果内容是 HTML，尝试把 HTML 标签去掉，返回纯文本（保留内部的 $...$ 标记）
const stripHtmlToText = (html) => {
    try {
        // 先用 DOMPurify 进行清洗，去掉危险属性/标签，但保留文本内容
        const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: [] });
        // clean 现在是没有任何标签的字符串，但某些实体可能仍在，创建临时元素解码实体
        const tmp = document.createElement('div');
        tmp.innerHTML = clean;
        const text = tmp.textContent || tmp.innerText || '';
        return text.trim();
    } catch {
        return html;
    }
};

// 从 HTML 中提取 class 包含 language-mermaid 的 code 块的文本内容，返回数组
const extractMermaidBlocksFromHtml = (html) => {
    try {
        const tmp = document.createElement('div');
        // 先用 DOMPurify 清洗，保留段落和 code/pre 标签以便检测（同时去除脚本和危险属性）
        tmp.innerHTML = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'code', 'pre'], ALLOWED_ATTR: ['class'] });
        // 优先查找带 language-mermaid 类的 code 标签
        let codes = tmp.querySelectorAll('code.language-mermaid');
        // 如果没有 class 标记，也尝试查找所有 pre>code 或 pre 元素，判断内容是否看起来像 mermaid（以 mermaid 关键字开头）
        if (!codes || codes.length === 0) {
            const possible = tmp.querySelectorAll('pre > code, pre');
            const arr = [];
            possible.forEach(node => {
                // normalize non-breaking spaces to regular spaces before trim/test
                const text = (node.textContent || '').replace(/\u00A0/g, ' ').trim();
                if (/^(graph|sequenceDiagram|classDiagram|stateDiagram|gantt|pie)\b/i.test(text)) {
                    arr.push(node);
                }
            });
            codes = arr;
        }

        // 进一步增强：有些富文本编辑器会把 mermaid 源拆成多个 <p>，例如每行一个 <p>，我们需要检测以 mermaid 关键字开头的 <p> 并合并连续段落
        if ((!codes || codes.length === 0)) {
            const pNodes = Array.from(tmp.querySelectorAll('p'));
            for (let i = 0; i < pNodes.length; i++) {
                // normalize non-breaking spaces to regular spaces before trim/test
                const txt = (pNodes[i].textContent || '').replace(/\u00A0/g, ' ').trim();
                if (/^(graph|sequenceDiagram|classDiagram|stateDiagram|gantt|pie)\b/i.test(txt)) {
                    // found start of mermaid block
                    let j = i;
                    const lines = [];
                    while (j < pNodes.length) {
                        const rawLine = (pNodes[j].textContent || '');
                        // normalize NBSP
                        const lineText = rawLine.replace(/\u00A0/g, ' ');
                        // stop when encounter an empty paragraph
                                    if (lineText.trim() === '') break;
                                    lines.push(lineText);
                        j++;
                    }
                    // remove these p nodes from DOM
                    for (let k = i; k < j; k++) {
                        const node = pNodes[k];
                        if (node.parentNode) node.parentNode.removeChild(node);
                    }
                                // 合并多行为一个 mermaid 源（使用换行符），避免把每行当作单独图表渲染
                                codes = [lines.join('\n')];
                    break;
                }
            }
        }
        const blocks = [];
                    codes.forEach(code => {
                        if (typeof code === 'string') {
                            blocks.push(code);
                        } else if (code && typeof code.textContent === 'string') {
                            blocks.push(code.textContent || '');
                            // remove the code block node so remaining HTML won't include it
                            const pre = code.closest && code.closest('pre');
                            if (pre && pre.parentNode) pre.parentNode.removeChild(pre);
                            else if (code.parentNode) code.parentNode.removeChild(code);
                        }
                    });
        return { blocks, remainingHtml: tmp.innerHTML };
    } catch {
        return { blocks: [], remainingHtml: html };
    }
};

function MarkdownRenderer({ content }) {
    // 移除 useEffect 中的 mermaid.initialize，因为现在由 MermaidChart 组件根据主题动态管理
    // useEffect(() => {
    //     mermaid.initialize({ startOnLoad: true, theme: 'default' });
    //     mermaid.contentLoaded();
    // }, []);

    if (!content) return null;

    if (containsMath(content) || (looksLikeHtml(content) && containsMath(stripHtmlToText(content)))) {
        // 如果原始内容是 HTML（来自编辑器），把它转换为纯文本再渲染 Markdown，这样能把内部的 $...$ 识别并渲染为公式
        return (
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    code({inline, className, children, ...props}){
                        const match = /language-(\w+)/.exec(className || '');
                        if (!inline && match && match[1] === 'mermaid') {
                            // 渲染 mermaid 图表
                            return <MermaidChart chart={String(children).replace(/\n$/, '')} />;
                        }
                        return <code className={className} {...props}>{children}</code>;
                    }
                }}
            >
                {looksLikeHtml(content) ? stripHtmlToText(content) : content}
            </ReactMarkdown>
        );
    } else if (looksLikeHtml(content)) {
        // 如果 HTML 中包含 mermaid code 块，优先把这些 code 块提取并渲染为图表
        const { blocks, remainingHtml } = extractMermaidBlocksFromHtml(content);
        if (blocks.length > 0) {
            return (
                <div>
                    {blocks.map((b, idx) => (
                        <div key={idx} style={{ marginBottom: '12px' }}>
                            <MermaidChart chart={b} />
                        </div>
                    ))}
                    {/* 渲染剩余的 HTML（已移除 mermaid code 块） */}
                    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(remainingHtml) }} />
                </div>
            );
        }
        // 最终渲染前再次消毒 HTML（双重保障）
        return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />;
    } else {
        return (
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
            >
                {content}
            </ReactMarkdown>
        );
    }
}

export default MarkdownRenderer;
