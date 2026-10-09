export async function api(path,method='GET',body) {
 const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Clienter-Request':'1'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok){const error=new Error(data.error||'Request failed');error.status=response.status;throw error;}return data;
}
export const amount=v=>Math.round(Number(v||0)*100);
export const today=()=>new Date().toLocaleDateString('en-CA');
export const month=()=>new Date().toISOString().slice(0,7);
export function download(name,body,type='application/json'){
 const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function calendarFile(meeting){
 const format=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const escape=v=>String(v||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const start=new Date(meeting.starts_at);const end=new Date(+start+meeting.duration*60000);
 download('meeting.ics',`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Clienter//Meetings//EN\r\nBEGIN:VEVENT\r\nUID:${meeting.id}@clienter\r\nDTSTAMP:${format(new Date())}\r\nDTSTART:${format(start)}\r\nDTEND:${format(end)}\r\nSUMMARY:${escape(meeting.title)}\r\nLOCATION:${escape(meeting.location)}\r\nDESCRIPTION:${escape(meeting.notes)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,'text/calendar');
}
