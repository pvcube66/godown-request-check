import { previewText, type TemplateButton } from '@anomaly/core/template-rules';

/** How a message looks on the phone: header, text with the example values, footer and buttons. Used by the template editor and the send screens. */
export default function WaPreview({ header, body, examples = [], footer, buttons = [], headerExample = '' }: { header?: string; body: string; examples?: readonly string[]; footer?: string; buttons?: readonly TemplateButton[]; headerExample?: string }) {
  return (
    <div className="wa-phone" aria-label="Preview of the message">
      <div className="wa-bubble">
        {header?.trim() && <p className="wa-head">{previewText(header, [headerExample])}</p>}
        <p className="wa-body">{body.trim() ? previewText(body, examples) : <span className="mut">Your message appears here</span>}</p>
        {footer?.trim() && <p className="wa-foot">{footer}</p>}
        <span className="wa-time">now ✓✓</span>
      </div>
      {buttons.length > 0 && <div className="wa-buttons">{buttons.map((b, i) => <span key={i}>{b.text || 'Button'}</span>)}</div>}
    </div>
  );
}
