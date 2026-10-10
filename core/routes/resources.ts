const modulename = 'WebServer:Resources';
import path from 'node:path';
import slash from 'slash';
import consoleFactory from '@lib/console';
import { requestResourceReport } from '@lib/fxserver/resourceReport';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { ResourceGroupType, ResourcesListResp } from '@shared/resourcesApiTypes';
const console = consoleFactory(modulename);


const breakPath = (inPath: string) => slash(path.normalize(inPath)).split('/').filter(String);
const trimOrNull = (value: unknown) => {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/**
 * Returns the folder a resource lives in, relative to the server data `resources` folder.
 */
const getResourceSubPath = (resPath: string) => {
    if (resPath.includes('system_resources')) return 'system_resources';
    if (!path.isAbsolute(resPath)) return resPath;

    const serverDataPathArr = breakPath(`${txConfig.server.dataPath}/resources`);
    const resPathArr = breakPath(resPath);
    let commonPrefix = 0;
    while (
        commonPrefix < serverDataPathArr.length
        && commonPrefix < resPathArr.length
        && serverDataPathArr[commonPrefix].toLowerCase() === resPathArr[commonPrefix].toLowerCase()
    ) {
        commonPrefix++;
    }
    //drop the matching prefix and the resource folder itself
    const subPathArr = resPathArr.slice(commonPrefix, -1);
    return subPathArr.length ? subPathArr.join('/') : 'root';
};


/**
 * Returns the resources list grouped by folder
 */
export default async function Resources(ctx: AuthedCtx) {
    const sendTypedResp = (data: ResourcesListResp) => ctx.send(data);
    if (!txCore.fxRunner.child?.isAlive) {
        return sendTypedResp({ error: 'The resources list is only available when the server is running.' });
    }

    const report = await requestResourceReport();
    if (!report) {
        return sendTypedResp({
            error: 'Could not load the resources list. Make sure the server is online, has fewer than 1000 resources, is not running outside of txAdmin, and check the Live Console for malformed fxmanifest.lua files.',
        });
    }

    const groups = new Map<string, ResourceGroupType>();
    for (const resource of report) {
        if (
            typeof resource?.name !== 'string'
            || typeof resource?.status !== 'string'
            || typeof resource?.path !== 'string'
            || !resource.path.length
        ) {
            continue;
        }
        const subPath = getResourceSubPath(resource.path);
        let group = groups.get(subPath);
        if (!group) {
            group = { subPath, resources: [] };
            groups.set(subPath, group);
        }
        group.resources.push({
            name: resource.name,
            status: resource.status,
            version: trimOrNull(resource.version),
            author: trimOrNull(resource.author),
            description: trimOrNull(resource.description),
        });
    }

    for (const group of groups.values()) {
        group.resources.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sendTypedResp({ groups: [...groups.values()] });
};
