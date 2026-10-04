import { defineRailway, github, preserve, project, service } from 'railway/iac';
export default defineRailway(() => project('pretty-sparkle', {
 resources: [service('portfolio-tracker', {
  source: github('satviksinghal31/BoardroomX', {branch:'main',rootDirectory:'screener-tracker-onboarding/full'}),
  start:'npm start', replicas:1,
  env:{PORT:preserve()}
 })]
}));
