import {uiText} from './i18n.mjs';
import {icon} from './icons.mjs';

export async function mountModelPreference(cloud) {
  const modal=cloud.modal,identity=modal.querySelector('.cloud-identity');
  if(!identity)return;
  const section=cloud.document.createElement('section');
  section.className='cloud-model-preference';
  const loading=cloud.document.createElement('span');
  loading.className='model-settings-loading';loading.setAttribute('role','status');
  loading.setAttribute('aria-label',uiText('modelSettings.loading'));loading.innerHTML=icon('refresh-cw');
  section.append(loading);identity.after(section);
  const valid=()=>section.isConnected&&cloud.modal===modal&&modal.open;
  const load=async()=>{
    section.replaceChildren(loading);
    try {
      const data=await cloud.request('/api/v1/profile/model');
      if(!valid())return;
      if(!data.can_select){section.remove();return;}
      section.replaceChildren();
      const heading=cloud.document.createElement('div');heading.className='cloud-model-heading';
      const mark=cloud.document.createElement('span');mark.className='cloud-model-mark';mark.innerHTML=icon('sparkles');
      const label=cloud.document.createElement('label');label.htmlFor='profile-model';label.textContent=uiText('modelSettings.title');
      const description=cloud.document.createElement('p');description.textContent=uiText('modelSettings.description');
      const form=cloud.document.createElement('form');form.className='cloud-model-form';
      const select=cloud.document.createElement('select');select.id='profile-model';select.className='context-box';
      const groups=new Map();
      for(const item of data.models){const family=item.family||'flash';let group=groups.get(family);if(!group){group=cloud.document.createElement('optgroup');group.label=({flash:uiText('modelSettings.family.flash'),lite:uiText('modelSettings.family.lite'),pro:uiText('modelSettings.family.pro'),argon:uiText('modelSettings.family.argon')})[family];groups.set(family,group);select.append(group);}const option=cloud.document.createElement('option');option.value=item.id;option.textContent=item.name+(item.id===data.default_model?' '+uiText('modelSettings.default'):'');group.append(option);}
      select.value=data.selected_model;
      const button=cloud.document.createElement('button');button.type='submit';button.className='button secondary';button.textContent=uiText('modelSettings.save');button.disabled=true;
      const status=cloud.document.createElement('p');status.className='model-settings-status';status.setAttribute('role','status');
      select.addEventListener('change',()=>{button.disabled=select.value===data.selected_model;status.textContent='';});
      form.addEventListener('submit',async event=>{
        event.preventDefault();event.stopPropagation();button.disabled=true;select.disabled=true;status.textContent=uiText('modelSettings.saving');
        try{
          const saved=await cloud.request('/api/v1/profile/model',cloud.json({model_id:select.value}));
          if(!valid())return;
          data.selected_model=saved.selected_model;status.textContent=uiText('modelSettings.saved');
        }catch{if(valid())status.textContent=uiText('modelSettings.error');}
        finally{if(valid()){select.disabled=false;button.disabled=select.value===data.selected_model;}}
      });
      heading.append(mark,label);form.append(select,button);section.append(heading,description,form,status);
    }catch{
      if(!valid())return;
      const error=cloud.document.createElement('p');error.className='cloud-error';error.textContent=uiText('modelSettings.error');
      const retry=cloud.document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent=uiText('modelSettings.retry');retry.addEventListener('click',load);
      section.replaceChildren(error,retry);
    }
  };
  await load();
}
