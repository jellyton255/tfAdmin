import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProcessTree } from "@/pages/Diagnostics/process-tree";
import { numberToLocaleString } from "@/lib/utils";
import { DiagnosticsInfoTree } from "./info-tree";
import { DiagnosticsInfoList } from "./info-list";
import type { DiagnosticsDataApiResp } from "@shared/diagnosticsTypes";
import useSWR from "swr";
import { useBackendApi } from "@/hooks/fetch";
import CardContentOverlay from "@/components/CardContentOverlay";
import { PageHeader } from "@/components/page-header";
import { StethoscopeIcon } from "lucide-react";


export default function DiagnosticsPage() {
    const getDataApi = useBackendApi<DiagnosticsDataApiResp>({
        method: 'GET',
        path: '/diagnostics/getDiagnostics',
    });

    const swr = useSWR('/diagnostics/getDiagnostics', async () => {
        const data = await getDataApi({});
        if (!data) throw new Error('empty_response');
        if ('error' in data) throw new Error(data.error);
        return data;
    }, { revalidateOnFocus: false });


    if (!swr.data) {
        return (
            <div className="w-full h-1/3 relative">
                <CardContentOverlay
                    error={swr.error?.message}
                    loading={swr.isValidating ? 'Loading...' : false}
                    className="bg-transparent dark:bg-transparent"
                />
            </div>
        )
    }
    return (
        <div className="w-full space-y-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Diagnostics" icon={<StethoscopeIcon />} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 px-2 md:px-0">
                <div className="space-y-4">
                    {/* Runtime Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>txAdmin Runtime</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {Object.entries(swr.data.runtime).map(([key, value]) => (
                                <DiagnosticsInfoTree key={key} title={key} tree={value} />
                            ))}
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-4">
                    {/* Host Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Host</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <DiagnosticsInfoList list={swr.data.host} />
                        </CardContent>
                    </Card>

                    {/* Server Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Server</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <DiagnosticsInfoList list={swr.data.server} />
                        </CardContent>
                    </Card>

                    {/* Processes Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Processes</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ProcessTree processes={swr.data.processes} />
                        </CardContent>
                    </Card>

                    <div className="italic text-center text-sm text-muted-foreground">
                        Loaded in {numberToLocaleString(swr.data.loadTime)} ms
                    </div>
                </div>
            </div>
        </div>
    )
}
