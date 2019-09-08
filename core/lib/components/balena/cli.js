/* Copyright 2019 balena
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const Docker = require('dockerode');
const { ensureFile } = require('fs-extra');
const { exec, spawn } = require('mz/child_process');
const { basename, dirname, join } = require('path');

module.exports = class CLI {
  preload(image, options) {
    return new Promise(async (resolve, reject) => {
      // We are making use of the docker daemon on the host, so we need to figure out where our image is on the host
      const docker = new Docker();

      const Container = docker.getContainer(
        // Get containerId from inside our container
        (await exec('cat /proc/self/cgroup | head -1 | sed "s/.*docker\\///g" | tr -d "\n"'))[0]
      );
      const Inspect = await Container.inspect();
      const Mount = Inspect.Mounts.find(mount => {
        return mount.Name != null
          ? mount.Name.slice(mount.Name.length - Inspect.Config.Labels.share.length) ===
              Inspect.Config.Labels.share
          : false;
      });

      if (Mount == null || dirname(image) !== Mount.Destination) {
        throw new Error('OS image not found in the expected volume, cannot preload.');
      }

      // We have to deal with the fact that our image exist on the fs the preloader runs in a different
      // path than where our docker daemon runs. Until we fix the issue on the preloader
      await ensureFile(join(Mount.Source, basename(image)));

      const child = spawn(
        'balena',
        [
          `preload --docker /var/run/docker.sock --app ${options.app} --commit ${
            options.commit
          } --pin-device-to-release ${options.pin} ${join(Mount.Source, basename(image))}`
        ],
        {
          stdio: 'inherit',
          shell: true
        }
      );

      function handleSignal(signal) {
        child.kill(signal);
      }

      process.on('SIGINT', handleSignal);
      process.on('SIGTERM', handleSignal);
      child.on('exit', () => {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
        resolve();
      });
      child.on('error', err => {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
        reject(err);
      });
    });
  }
  push(target, options) {
    return exec(`balena push ${target} --source ${options.source} --nolive --detached`);
  }
  loginWithToken(token) {
    return exec(`balena login --token ${token}`);
  }
  logs(target, service) {
    return exec(`balena logs ${target} ${service ? '--service' + service : ''}`);
  }
};
