// Apply a circular alpha mask to the approved PNG without changing the TD artwork.
// Works in Workers and Node 22 through standards-based Compression Streams.
const PNG_SIGNATURE = [137,80,78,71,13,10,26,10];
const textEncoder = new TextEncoder();
const asBytes = input => input instanceof Uint8Array ? input : new Uint8Array(input);
const read32 = (a,i) => ((a[i]*0x1000000)+(a[i+1]<<16)+(a[i+2]<<8)+a[i+3])>>>0;
const put32 = (a,i,v) => {a[i]=(v>>>24)&255;a[i+1]=(v>>>16)&255;a[i+2]=(v>>>8)&255;a[i+3]=v&255};
const concat = arrays => {const result=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){result.set(a,at);at+=a.length}return result};
function pngChunk(label,payload){
  const name=textEncoder.encode(label),out=new Uint8Array(payload.length+12);
  put32(out,0,payload.length);out.set(name,4);out.set(payload,8);
  let crc=0xffffffff;
  for(let i=4;i<out.length-4;i++){crc^=out[i];for(let j=0;j<8;j++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}
  put32(out,out.length-4,(crc^0xffffffff)>>>0);
  return out;
}
async function codec(bytes,algorithm){
  const stream=new Blob([bytes]).stream().pipeThrough(
    algorithm==='inflate'?new DecompressionStream('deflate'):new CompressionStream('deflate')
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const paeth=(a,b,c)=>{
  const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);
  return da<=db&&da<=dc?a:db<=dc?b:c;
};
/**
 * Preserve source pixels inside the approved circular artwork and make outside pixels
 * fully transparent. Only 8-bit, non-interlaced RGBA PNGs are accepted (fail closed).
 */
export async function circularTransparentPng(encoded){
  const binary=atob(encoded),data=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(PNG_SIGNATURE.some((v,i)=>data[i]!==v))throw new Error('Invalid PNG signature');
  let ihdr=null,compressed=[],pos=8;
  while(pos+12<=data.length){
    const length=read32(data,pos),type=String.fromCharCode(...data.subarray(pos+4,pos+8));
    if(length>data.length-pos-12)throw new Error('Invalid PNG chunk length');
    const content=data.subarray(pos+8,pos+8+length);
    if(type==='IHDR')ihdr=new Uint8Array(content);
    if(type==='IDAT')compressed.push(content);
    pos+=length+12;
    if(type==='IEND')break;
  }
  if(!ihdr||ihdr.length!==13||ihdr[8]!==8||ihdr[9]!==6||ihdr[12]!==0)
    throw new Error('Unsupported PNG format');
  const width=read32(ihdr,0),height=read32(ihdr,4);
  if(width!==512||height!==512)throw new Error('Unexpected brand icon size');
  const source=await codec(concat(compressed),'inflate');
  const stride=width*4,rowSize=stride+1;
  if(source.length!==rowSize*height)throw new Error('Unexpected PNG raster size');
  const output=new Uint8Array(source.length),before=new Uint8Array(stride);
  const centerX=width/2,centerY=height/2,radius=Math.min(width,height)*0.493;
  for(let y=0;y<height;y++){
    const start=y*rowSize,filter=source[start],row=new Uint8Array(stride);
    if(filter>4)throw new Error('Unsupported PNG row filter');
    for(let i=0;i<stride;i++){
      const left=i>=4?row[i-4]:0,up=before[i],corner=i>=4?before[i-4]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner);
      row[i]=(source[start+1+i]+predictor)&255;
    }
    // PNG filter decoding must use the ORIGINAL previous row, never the masked row.
    // Otherwise up/Paeth predictors propagate the transparent corner pixels into
    // the approved TD artwork and progressively corrupt its colours and shape.
    before.set(row);
    for(let x=0;x<width;x++){
      const dx=x+.5-centerX,dy=y+.5-centerY;
      if(dx*dx+dy*dy>radius*radius){const i=x*4;row[i]=0;row[i+1]=0;row[i+2]=0;row[i+3]=0}
    }
    output[start]=0;output.set(row,start+1);
  }
  const deflated=await codec(output,'deflate');
  return concat([new Uint8Array(PNG_SIGNATURE),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflated),pngChunk('IEND',new Uint8Array())]);
}
