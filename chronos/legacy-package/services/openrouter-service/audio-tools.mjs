import fs from 'node:fs';
import path from 'node:path';
const formats=['mp3','wav','flac','opus','aac','pcm'];
export function audioTools({api,findModel,resolveOutDir,uniquePath,slug,stamp,UserError,writeReceipt}){
 const schema={model:{type:'string'},out_dir:{type:'string'},file_name:{type:'string'}};
 async function model(a,kind){const m=await findModel(a.model);if(!m.kinds.includes(kind))throw new UserError('Модель не поддерживает '+kind);return m}
 function save(a,m,data,format){const dir=resolveOutDir(a.out_dir);const f=uniquePath(dir,slug(a.file_name||stamp()+'-'+m.id),format);fs.writeFileSync(f,data);return f}
 return {
  generate_speech:{description:'Озвучить текст через OpenRouter Audio Speech API и сохранить аудиофайл. Для моделей kind=speech. voice — голос из документации выбранной модели.',inputSchema:{type:'object',required:['model','text','voice'],properties:{...schema,text:{type:'string'},voice:{type:'string'},format:{type:'string',enum:formats,default:'mp3'}}},async run(a){
   const m=await model(a,'speech'),format=a.format||'mp3';if(!formats.includes(format))throw new UserError('Неверный аудиоформат');
   const r=await api('POST','/api/v1/audio/speech',{raw:true,body:{model:m.id,input:a.text,voice:a.voice,response_format:format}});
   if(!/^(audio\/|application\/octet-stream)/i.test(r.headers.get('content-type')||''))throw new UserError('Вместо аудио сервер вернул другой формат');
   const data=Buffer.from(await r.arrayBuffer());if(!data.length)throw new UserError('Пустой аудиоответ');const file=save(a,m,data,format);
   writeReceipt({id:r.headers.get('x-generation-id')||r.headers.get('x-request-id')},m.id);return 'Аудио: '+file;
  }},
  transcribe_audio:{description:'Распознать локальный аудиофайл через OpenRouter Audio Transcriptions API. Для kind=transcription.',inputSchema:{type:'object',required:['model','file'],properties:{model:schema.model,file:{type:'string'},language:{type:'string'},prompt:{type:'string'}}},async run(a){
   const m=await model(a,'transcription'),file=path.resolve(a.file),format=path.extname(file).slice(1).toLowerCase();
   if(!['mp3','wav','flac','ogg','m4a','webm','aac'].includes(format))throw new UserError('Неподдерживаемый формат аудио');
   if(fs.statSync(file).size>100*1024*1024)throw new UserError('Аудиофайл больше 100 МиБ');
   const r=await api('POST','/api/v1/audio/transcriptions',{body:{model:m.id,input_audio:{data:fs.readFileSync(file).toString('base64'),format},...(a.language?{language:a.language}:{}),...(a.prompt?{prompt:a.prompt}:{})}});return r.text||JSON.stringify(r);
  }},
  generate_audio:{description:'Сгенерировать аудио через OpenRouter Chat Completions, модели kind=audio. Сохраняет аудио и возвращает текст/транскрипт, если они есть.',inputSchema:{type:'object',required:['model','prompt'],properties:{...schema,prompt:{type:'string'},voice:{type:'string'},format:{type:'string',enum:['mp3','wav','flac','opus','pcm16'],default:'wav'}}},async run(a){
   const m=await model(a,'audio'),format=a.format||'wav';const r=await api('POST','/api/v1/chat/completions',{body:{model:m.id,messages:[{role:'user',content:a.prompt}],modalities:['text','audio'],audio:{format,...(a.voice?{voice:a.voice}:{})}}});
   const msg=r.choices?.[0]?.message,audio=msg?.audio;if(!audio?.data)throw new UserError('Модель не вернула аудиоданные');
   const file=save(a,m,Buffer.from(audio.data,'base64'),format);return 'Аудио: '+file+'\n'+(audio.transcript||msg.content||'');
  }}
 };
}
