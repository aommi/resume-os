// One browser connection; bounded, observable operations for a scoped application worker.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadProfile} from './config.mjs';
import {readJson,writeJson,readPolicy} from './auto-apply.mjs';
import {buildAutofillPlan} from '../scripts/apply-form-assist.mjs';

export async function employerDebugCommand(page,command,{work,manifestPath,network=[]}) {
  if(command.action==='network')return network;
  if(command.action==='inspect')return page.evaluate(()=>({
    url:location.origin+location.pathname,title:document.title,text:document.body.innerText.slice(0,20000).replace(/((?:verification|security|one.time|otp)[^\n]{0,60}?)\b\d{4,8}\b/gi,'$1[redacted]'),
    focused:document.activeElement?{tag:document.activeElement.tagName,id:document.activeElement.id,role:document.activeElement.getAttribute('role'),label:document.activeElement.getAttribute('aria-label'),text:document.activeElement.matches('button,a,[role=button]')?document.activeElement.innerText:undefined}:null,
    controls:[...document.querySelectorAll('input,select,textarea,[role=combobox],[role=checkbox],[role=switch]')].map(el=>({
      tag:el.tagName,id:el.id,name:el.name,type:el.type,role:el.getAttribute('role'),
      label:el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||[...(el.labels||[])].map(l=>l.innerText).join(' '),
      value:el.type==='password'||el.type==='hidden'||/password|verification|security.?code|one.?time|otp|token/i.test(el.name+' '+el.id+' '+el.getAttribute('aria-label'))?'[redacted]':el.value,
      disabled:el.disabled,invalid:el.getAttribute('aria-invalid'),checked:el.checked,ariaChecked:el.getAttribute('aria-checked'),required:el.required||el.getAttribute('aria-required')==='true',
      visible:!!el.getClientRects().length,controls:el.getAttribute('aria-controls'),
      files:el.type==='file'?[...(el.files||[])].map(f=>f.name):undefined,
      options:el.tagName==='SELECT'?[...el.options].map(o=>({text:o.text,value:o.value,selected:o.selected})):undefined
    })),
    buttons:[...document.querySelectorAll('button,[role=option]')].filter(e=>e.getClientRects().length).map(e=>({id:e.id,text:e.innerText,disabled:e.disabled,tabIndex:e.tabIndex,type:e.type,role:e.getAttribute('role')})),
    links:[...document.querySelectorAll('a[href]')].filter(e=>/sign|log|account|privacy/i.test(e.innerText)).map(e=>({text:e.innerText,href:e.href}))
  }));
  if(!manifestPath)throw Error('A reviewed manifest is required for form writes');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const plan=buildAutofillPlan({manifest,profile:loadProfile(),work});
  if(command.action==='fill'||command.action==='select') {
    const field=plan.fields.find(f=>f.label===command.label&&!f.skipReason);
    if(!field)throw Error('Worker field must refer to a reviewed manifest answer');
    const loc=page.locator(command.selector||field.selectors[0]).first();
    if(command.action==='fill') {
      if(field.type==='checkbox'||field.type==='radio')await loc.setChecked(['true','yes','1'].includes(String(field.value).toLowerCase()),{timeout:5000});
      else await loc.fill(String(field.value),{timeout:5000});
    } else if(await loc.evaluate(el=>el.tagName==='SELECT')) {
      await loc.selectOption({label:String(field.value)},{timeout:5000});
    } else {
      const supported=await loc.evaluate(el=>el.getAttribute('role')==='combobox'||el.tagName==='INPUT'&&['text','search'].includes(el.type));
      if(!supported)throw Error('Custom select target must be a combobox input, not an arbitrary button');
      await loc.click({timeout:5000});
      const controls=await loc.getAttribute('aria-controls');
      const scope=controls?page.locator('[id='+JSON.stringify(controls)+']'):page;
      await scope.getByRole('option',{name:String(field.value),exact:true}).click({timeout:5000});
      await loc.press('Tab',{timeout:5000});
    }
    return {status:'performed',label:field.label};
  }
  if(command.action==='upload') {
    const file=plan.fileUploads.find(f=>f.label===command.label&&!f.skipReason);
    if(!file)throw Error('Worker upload must refer to a reviewed manifest file');
    await page.locator(command.selector||file.selectors[0]).first().setInputFiles(file.path,{timeout:5000});
    return {status:'performed',label:file.label};
  }
  if(command.action==='click') {
    const loc=page.locator(command.selector).first();
    const text=await loc.innerText({timeout:3000});
    const finalLocator=page.locator(manifest.submit.selector);
    const finalHandle=await finalLocator.count()?await finalLocator.first().elementHandle():null;
    const control=await loc.evaluate((el,final)=>{const control=el.closest('button,input,[role=button]')||el;return {final:!!final&&(control===final||control.contains(final)||final.contains(control)),submit:control.type==='submit'};},finalHandle);
    await finalHandle?.dispose();
    const action=manifest.nonFinalActions?.find(a=>a.selector===command.selector&&a.purpose==='resume_upload_privacy');
    const policy=readPolicy(work);
    const consent=/^(?:i\s+)?agree\b|^accept\b/i.test(text.trim())&&policy.requiredTerms==='allow';
    const account=/sign in|log in|register|create account/i.test(text)&&policy.accounts==='allow';
    const cancel=/^(cancel|close|decline)$/i.test(text.trim());
    if(control.final||/submit|send application|finish application|complete application|apply now/i.test(text)||control.submit&&!action&&!consent&&!account&&!cancel)throw Error('Worker cannot perform final application submission');
    if(/sign in|log in|register|create account/i.test(text)&&readPolicy(work).accounts!=='allow')throw Error('Account action is not authorized');
    if(/i agree|accept/i.test(text)&&policy.requiredTerms!=='allow')throw Error('Application consent is disabled');
    await loc.click({timeout:5000});return {status:'performed',text};
  }
  throw Error('Unsupported debug command');
}

export async function serviceDebugCommand(page,directory,requestId,context,handled) {
  const command=readJson(join(directory,'command.json'),{});
  if(command.requestId!==requestId||!command.commandId||handled.has(command.commandId))return;
  handled.add(command.commandId);
  let result;
  try{result={ok:true,result:await employerDebugCommand(page,command,context)};}
  catch(error){result={ok:false,error:error.message};}
  writeJson(join(directory,'command-result.json'),{requestId,commandId:command.commandId,...result});
}
