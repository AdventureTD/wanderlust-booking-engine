import asyncio,json,sys,hashlib,base64,re,subprocess
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from playwright.async_api import async_playwright

async def main():
    observed=[]
    armed=[False]
    fixture=sys.argv[2]
    module=Path(sys.argv[3]).read_text()
    body=module[:module.index('export function hashPhone')].replace("import crypto from 'crypto';","const crypto=require('crypto');").replace("import { normalizePhone } from 'public/phoneNormalization';",'').replace('export function','function')
    normalized=fixture.replace(' ','').lower()
    local,domain=normalized.split('@')
    variants={'lowercaseOnly':normalized,'dotsRemovedPlusRetained':local.replace('.','')+'@'+domain,'dotsAndPlusRemovedDomainRetained':local.split('+')[0].replace('.','')+'@'+domain}
    digests={k:[hashlib.sha256(v.encode()).hexdigest(),base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip('=')] for k,v in variants.items()}
    expected=subprocess.check_output(['node.exe','-e',body+';process.stdout.write(hashEmail(process.argv[1]));',fixture],text=True).strip()
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(channel='chrome',headless=True)
        context=await browser.new_context()
        async def guard(route):
            request=route.request
            u=urlsplit(request.url)
            is_google=any(u.hostname==h or (u.hostname or '').endswith('.'+h) for h in ['google.com','google.co.uk','googleadservices.com','doubleclick.net','google-analytics.com','googletagmanager.com','googlesyndication.com'])
            library=(u.hostname=='www.googletagmanager.com' and (u.path=='/gtag/js' or u.path=='/gtm.js'))
            if not library and (is_google or armed[0]):
                payload=(request.post_data_buffer or b'').decode('utf-8',errors='replace')
                values=parse_qs(u.query)
                observed.append({'host':u.hostname,'path':u.path,'keys':sorted(values),'event':values.get('en',[]),'hasEmailField':bool(values.get('em')),'expectedHashPresent':any(h in request.url or h in payload or h in ' '.join(values.get('em',[])) for h in [expected,base64.urlsafe_b64encode(bytes.fromhex(expected)).decode().rstrip('=')]),'matchingNormalizationVariants':[k for k,hs in digests.items() if any(h in request.url or h in payload or h in ' '.join(values.get('em',[])) for h in hs)],'validHashPresent':any(re.search(r'(?:em\.|^)(?:[A-Fa-f0-9]{64}|[A-Za-z0-9_-]{43})(?:[~.]|$)',v) is not None for v in values.get('em',[])),'emailEncodingLengths':[len(v) for v in values.get('em',[])],'blocked':True})
                await route.abort();return
            if any(x in request.url for x in ['createBooking','recordBookingConversion','issueBookingInvoice','events:ingest']):
                raise RuntimeError('Unexpected booking/send call')
            await route.continue_()
        await context.route('**/*',guard)
        page=await context.new_page()
        await page.goto('https://www.wanderlustcaribbean.com/booking-summary',wait_until='domcontentloaded',timeout=60000)
        await page.wait_for_function("typeof gtag==='function' && document.querySelector('#comp-mqo6cvon input[type=email][name=email]')",timeout=60000)
        await page.wait_for_timeout(7000)
        originalVisible=await page.locator('#comp-mqo6cvon input[type=email][name=email]').is_visible()
        # Direct Summary lacks a quote and hides content. Remove that confound only inside the isolated probe.
        await page.evaluate("() => {let e=document.querySelector('#comp-mqo6cvon input[type=email][name=email]');while(e){e.style.setProperty('display','block','important');e.style.setProperty('visibility','visible','important');e.style.setProperty('opacity','1','important');e.removeAttribute('hidden');e=e.parentElement;}}")
        visible=await page.locator('#comp-mqo6cvon input[type=email][name=email]').is_visible()
        assert visible
        before=len(observed)
        armed[0]=True
        # Synthetic fixture stays in this isolated browser. Every Google measurement request is blocked.
        await page.locator('#comp-mqo6cvon input[type=email][name=email]').fill(fixture,force=True)
        await page.evaluate("() => gtag('event','form_submit',{send_to:'AW-788746633'})")
        await page.wait_for_timeout(6000)
        split=len(observed)
        await page.evaluate("email => {gtag('set','user_data',{email});gtag('event','form_submit',{send_to:'AW-788746633'});}",fixture)
        await page.wait_for_timeout(6000)
        result={'originalVisible':originalVisible,'probeVisible':visible,'mode':'isolated browser; synthetic email; all Google measurement endpoints blocked; no booking','selectorCount':await page.locator('#comp-mqo6cvon input[type=email][name=email]').count(),'before':observed[:before],'selectorOnly':observed[before:split],'explicitUserData':observed[split:]}
        Path(sys.argv[1]).write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({k:[{f:r[f] for f in ['path','hasEmailField','validHashPresent','expectedHashPresent','matchingNormalizationVariants']} for r in result[k] if r['hasEmailField']] for k in ['selectorOnly','explicitUserData']}))
        await browser.close()
asyncio.run(main())
