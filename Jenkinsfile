// Verification-only. The owner must provision a dedicated, non-production agent.
// Do not point this label at a production host or accept untrusted fork builds here.
pipeline {
  agent { label 'discord-bot-verify' }
  options {
    disableConcurrentBuilds()
    timeout(time: 15, unit: 'MINUTES')
  }
  stages {
    stage('Verify runtime') {
      steps {
        sh '''set -eu
node -e 'if (process.versions.node !== "24.21.0") process.exit(1)'
npm --version
'''
      }
    }
    stage('Install') { steps { sh 'npm ci --ignore-scripts --no-audit' } }
    stage('Verify') { steps { sh 'npm run verify' } }
    stage('Dependency audit') { steps { sh 'npm audit --audit-level=high && npm run sbom' } }
    stage('Candidate image') {
      when { branch 'main' }
      steps {
        sh '''set -eu
commit=$(git rev-parse --verify HEAD)
case "$commit" in *[!0-9a-f]*|'') exit 1 ;; esac
test "${#commit}" -eq 40
docker build --pull -t "jenkins/dc_chatgpt:git-${commit}" .
'''
      }
    }
  }
  // No credentials, docker run/rm, production changes, or automatic cutover.
}
