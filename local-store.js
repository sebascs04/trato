// Durable browser storage for the local prototype; not Supabase or user authentication.
window.TratoStore = (() => {
  const dbName='trato-local-prototype';
  let pending=Promise.resolve();
  function open(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(dbName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });}
  async function load(){
    const db=await open();
    try {
      const value=await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readonly');const req=tx.objectStore('workspace').get('changes');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
      if(!value || value.schemaVersion!==1)return null;
      for(const doc of value.documents || []){
        if(doc.pdfBlob instanceof Blob){doc.pdfUrl=URL.createObjectURL(doc.pdfBlob);delete doc.pdfBlob;}
      }
      return value;
    } finally {db.close();}
  }
  function save(snapshot){
    // Serialise writes so an older async Blob read cannot overwrite a newer draft.
    const copy=structuredClone(snapshot);
    const task=pending.catch(()=>{}).then(async()=>{
      for(const doc of copy.documents){
        if(doc.pdfUrl?.startsWith('blob:')){
          const response=await fetch(doc.pdfUrl);if(!response.ok)throw new Error('No se pudo guardar el PDF local.');
          doc.pdfBlob=await response.blob();delete doc.pdfUrl;
        }
      }
      const db=await open();
      try {await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(copy,'changes');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
      finally {db.close();}
    });
    pending=task;return task;
  }
  return {load,save};
})();
