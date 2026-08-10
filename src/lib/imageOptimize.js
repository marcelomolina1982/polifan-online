export async function optimizeImage(file,{maxWidth=1400,maxHeight=1400,quality=.82}={}){
  if(!file||!String(file.type||'').startsWith('image/'))return file
  if(file.size<450000)return file
  const bitmap=await createImageBitmap(file)
  const scale=Math.min(1,maxWidth/bitmap.width,maxHeight/bitmap.height)
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale))
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  canvas.getContext('2d').drawImage(bitmap,0,0,width,height);bitmap.close?.()
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality))
  return blob||file
}
export async function fileToOptimizedDataUrl(file,options){
  const optimized=await optimizeImage(file,options)
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsDataURL(optimized)})
}
