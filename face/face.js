// 얼굴 전체 분석 모드에서만 동적으로 로드되는 ES 모듈 (구형 브라우저는 이 파일을 아예 불러오지 않음)
import { FaceLandmarker } from './vision_bundle.mjs';
window.HowFaceLib = { FaceLandmarker: FaceLandmarker };
window.dispatchEvent(new Event('howface-lib'));
