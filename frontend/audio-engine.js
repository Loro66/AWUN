(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SongvaleAudioEngine=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const PROFILES=Object.freeze({
    neutral:Object.freeze({
      low:{frequency:105,gain:0},high:{frequency:7200,gain:0},
      compressor:{threshold:-18,knee:12,ratio:1.35,attack:.018,release:.28}
    }),
    warm:Object.freeze({
      low:{frequency:118,gain:1.8},high:{frequency:6800,gain:-.7},
      compressor:{threshold:-20,knee:14,ratio:1.55,attack:.024,release:.34}
    }),
    clarity:Object.freeze({
      low:{frequency:92,gain:-.6},high:{frequency:5200,gain:1.65},
      compressor:{threshold:-19,knee:10,ratio:1.45,attack:.014,release:.24}
    })
  });
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value)||0));
  const dbToGain=db=>Math.pow(10,Number(db||0)/20);
  const rmsFromTimeDomain=values=>{
    if(!values?.length)return 0;
    let sum=0;for(const value of values){const sample=(value-128)/128;sum+=sample*sample}
    return Math.sqrt(sum/values.length);
  };
  const loudnessCorrection=(rms,currentDb=0)=>{
    if(!Number.isFinite(rms)||rms<.012)return currentDb;
    const measuredDb=20*Math.log10(rms),targetDb=-18;
    return clamp(currentDb*.92+clamp(targetDb-measuredDb,-3,3)*.08,-3,3);
  };

  class Engine{
    constructor(media,{profile='neutral',enabled=true}={}){
      this.media=media;this.profile=PROFILES[profile]?profile:'neutral';this.enabled=enabled;
      this.context=null;this.source=null;this.input=null;this.low=null;this.high=null;
      this.compressor=null;this.limiter=null;this.output=null;this.analyser=null;
      this.timer=null;this.normalizationDb=0;this.samples=null;this.available=false;
    }
    async connect(){
      if(this.context){await this.context.resume();return this.available}
      const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Context||!this.media)return false;
      try{
        const context=new Context(),source=context.createMediaElementSource(this.media);
        const input=context.createGain(),low=context.createBiquadFilter(),high=context.createBiquadFilter();
        const compressor=context.createDynamicsCompressor(),limiter=context.createDynamicsCompressor();
        const output=context.createGain(),analyser=context.createAnalyser();
        low.type='lowshelf';high.type='highshelf';analyser.fftSize=2048;analyser.smoothingTimeConstant=.78;
        source.connect(input);input.connect(low);low.connect(high);high.connect(compressor);
        compressor.connect(limiter);limiter.connect(output);output.connect(context.destination);
        limiter.threshold.value=-1.2;limiter.knee.value=1.5;limiter.ratio.value=20;
        limiter.attack.value=.002;limiter.release.value=.09;
        high.connect(analyser);
        Object.assign(this,{context,source,input,low,high,compressor,limiter,output,analyser,samples:new Uint8Array(analyser.fftSize),available:true});
        this.applyProfile(this.profile,false);this.setEnabled(this.enabled,false);this.startAnalysis();
        await context.resume();return true;
      }catch(error){this.available=false;return false}
    }
    applyProfile(profile,ramp=true){
      this.profile=PROFILES[profile]?profile:'neutral';if(!this.context)return;
      const preset=PROFILES[this.profile],now=this.context.currentTime,move=(param,value,duration=.18)=>{
        param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);
        ramp?param.linearRampToValueAtTime(value,now+duration):param.setValueAtTime(value,now);
      };
      this.low.frequency.value=preset.low.frequency;this.high.frequency.value=preset.high.frequency;
      move(this.low.gain,preset.low.gain);move(this.high.gain,preset.high.gain);
      for(const [key,value] of Object.entries(preset.compressor))this.compressor[key].value=value;
    }
    setEnabled(enabled,ramp=true){
      this.enabled=Boolean(enabled);if(!this.context)return;
      this.applyProfile(this.enabled?this.profile:'neutral',ramp);
      const now=this.context.currentTime,target=this.enabled?dbToGain(this.normalizationDb):1;
      this.input.gain.cancelScheduledValues(now);this.input.gain.setTargetAtTime(target,now,ramp?.08:0);
    }
    setOutputLevel(level){
      if(!this.context)return;const now=this.context.currentTime;
      this.output.gain.cancelScheduledValues(now);this.output.gain.setTargetAtTime(clamp(level,0,1),now,.015);
    }
    fadeTo(level,duration=.16){
      if(!this.context)return Promise.resolve();
      const now=this.context.currentTime,target=clamp(level,0,1);
      this.output.gain.cancelScheduledValues(now);this.output.gain.setValueAtTime(this.output.gain.value,now);
      this.output.gain.linearRampToValueAtTime(target,now+duration);
      return new Promise(resolve=>setTimeout(resolve,duration*1000));
    }
    startAnalysis(){
      clearInterval(this.timer);this.timer=setInterval(()=>{
        if(!this.enabled||!this.analyser||this.media?.paused)return;
        this.analyser.getByteTimeDomainData(this.samples);
        this.normalizationDb=loudnessCorrection(rmsFromTimeDomain(this.samples),this.normalizationDb);
        const now=this.context.currentTime,target=dbToGain(this.normalizationDb);
        this.input.gain.cancelScheduledValues(now);this.input.gain.setTargetAtTime(target,now,1.8);
      },750);
    }
    status(){return{available:this.available,enabled:this.enabled,profile:this.profile,normalizationDb:Number(this.normalizationDb.toFixed(2))}}
    destroy(){clearInterval(this.timer);this.timer=null;try{this.context?.close()}catch{}this.available=false}
  }
  return{Engine,PROFILES,clamp,dbToGain,rmsFromTimeDomain,loudnessCorrection};
});
