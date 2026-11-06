"""Presentation shell only. Message data, recipients and attachments stay unchanged."""
from html import escape

def email_layout(title,project,content,*,mascot_src='https://trato-web-68896425401.us-central1.run.app/assets/mascot/trato-guide.png'):
    body=content.replace('<p>','<p style="font-size:15px;line-height:1.8;color:#62576d;margin:0 0 18px">')
    body=body.replace('<a href=','<a style="display:inline-block;background:#7051c6;color:#fff;padding:15px 24px;border-radius:11px;text-decoration:none;font-weight:bold" href=')
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        '<body style="margin:0;background:#f6f3fa;font-family:Arial,Helvetica,sans-serif;color:#302837">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">'
        '<table role="presentation" width="580" cellspacing="0" cellpadding="0" style="width:100%;max-width:580px">'
        '<tr><td style="padding:0 8px 22px;font-size:32px;font-weight:bold;letter-spacing:-1px">trato<span style="color:#8060b0">.</span></td></tr>'
        '<tr><td style="background:#fff;border:1px solid #e6dcef;border-radius:22px;padding:30px">'
        '<img src="'+escape(mascot_src,quote=True)+'" alt="TeTrato" width="112" height="112" style="display:block;margin:0 auto 20px;border:0">'
        '<h1 style="font-size:27px;line-height:1.3;margin:0 0 10px;font-weight:600">'+escape(title)+'</h1>'
        '<p style="font-size:16px;color:#8060b0;margin:0 0 26px;line-height:1.6">'+escape(project)+'</p>'
        +body+'<!-- attachment-note -->'
        '</td></tr><tr><td align="center" style="padding:22px;font-size:12px;color:#85788f">Trato</td></tr></table></td></tr></table></body></html>')
